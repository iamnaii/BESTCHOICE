# Product Sticker Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างระบบพิมพ์สติกเกอร์ติดเครื่อง 50×30mm (รุ่น+สเปค+ประกัน+ราคาเงินสด+เรทผ่อน 2 เรท+IMEI+โลโก้) จาก `/stock` แบบ bulk

**Architecture:**
- Backend: extend `StickersService` to compose data from `Product` + `PricingTemplate` (with new rate1/rate2 fields) + `SystemConfig` defaults + SHOP `CompanyInfo.logoUrl`
- Frontend: rebuild `/stickers` page (50×30mm thermal layout, no barcode), add bulk-select action in `/stock`, add sticker defaults section in `/settings`, extend pricing-templates form

**Tech Stack:** NestJS + Prisma + React + TanStack Query + shadcn/ui + Tailwind CSS

**Spec:** [docs/superpowers/specs/2026-05-07-product-sticker-print-design.md](../specs/2026-05-07-product-sticker-print-design.md)

---

## File Structure

### Backend (`apps/api`)

| File | Action | Responsibility |
|---|---|---|
| `prisma/migrations/20260807100000_sticker_pricing_rates/migration.sql` | Create | Add 4 cols to `pricing_templates` + seed 4 `system_configs` rows |
| `prisma/schema.prisma` | Modify | Add `rate1DownPayment`, `rate1TermMonths`, `rate2DownPayment`, `rate2TermMonths` to `PricingTemplate` |
| `src/modules/stickers/stickers.service.ts` | Modify | Extend `getStickerData()` to return new shape + new `getStickerDataBatch()` |
| `src/modules/stickers/stickers.controller.ts` | Modify | Add `GET /sticker-templates/products/data` batch endpoint |
| `src/modules/stickers/stickers.service.spec.ts` | Create | Unit tests for `getStickerData` + `getStickerDataBatch` |
| `src/modules/pricing-templates/dto/pricing-template.dto.ts` | Modify | Add 4 optional fields to Create + Update DTOs |
| `src/modules/pricing-templates/pricing-templates.service.ts` | Modify | Persist 4 new fields on create/update |

### Frontend (`apps/web`)

| File | Action | Responsibility |
|---|---|---|
| `src/pages/StickerPrintPage.tsx` | Replace | New 50×30mm layout, bulk product list, print CSS |
| `src/pages/StockPage/index.tsx` | Modify | Pass `onBulkPrintStickers` callback to StockListTab; navigate to `/stickers?productIds=...` |
| `src/pages/StockPage/components/StockListTab.tsx` | Modify | Wire DataTable `selectable` + bulk action "พิมพ์สติกเกอร์" |
| `src/pages/SettingsPage/components/StickerSettings.tsx` | Create | Sticker defaults section (4 inputs, OWNER-only) |
| `src/pages/SettingsPage/index.tsx` | Modify | Mount new `StickerSettings` section |
| `src/pages/PricingTemplatesPage.tsx` | Modify | Add 4 inputs (rate1/rate2 down + term) in create/edit form |

---

## Task 1: Database migration + schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260807100000_sticker_pricing_rates/migration.sql`

- [ ] **Step 1: Edit `schema.prisma` — add 4 fields to `PricingTemplate`**

Find the `model PricingTemplate { ... }` block (around line 1496). After the line `installmentFinancePrice    Decimal         @map("installment_finance_price") @db.Decimal(12, 2)` and before `isActive`, insert:

```prisma
  // Sticker rates (nullable — fallback to SystemConfig defaults if null)
  rate1DownPayment  Decimal? @map("rate1_down_payment") @db.Decimal(12, 2)
  rate1TermMonths   Int?     @map("rate1_term_months")
  rate2DownPayment  Decimal? @map("rate2_down_payment") @db.Decimal(12, 2)
  rate2TermMonths   Int?     @map("rate2_term_months")
```

- [ ] **Step 2: Create migration directory + SQL**

Create file `apps/api/prisma/migrations/20260807100000_sticker_pricing_rates/migration.sql` with content:

```sql
-- Add rate1/rate2 sticker fields to pricing_templates
ALTER TABLE "pricing_templates"
  ADD COLUMN "rate1_down_payment" DECIMAL(12, 2),
  ADD COLUMN "rate1_term_months" INTEGER,
  ADD COLUMN "rate2_down_payment" DECIMAL(12, 2),
  ADD COLUMN "rate2_term_months" INTEGER;

-- Seed default sticker config (insert if not exists)
INSERT INTO "system_configs" ("id", "key", "value", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'sticker.rate1.defaultDown', '0', NOW(), NOW()),
  (gen_random_uuid(), 'sticker.rate1.defaultTerm', '24', NOW(), NOW()),
  (gen_random_uuid(), 'sticker.rate2.defaultDown', '0', NOW(), NOW()),
  (gen_random_uuid(), 'sticker.rate2.defaultTerm', '12', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 3: Apply migration to dev database**

Run: `cd apps/api && npx prisma migrate dev --name sticker_pricing_rates`
Expected: migration applies cleanly, Prisma Client regenerates.

- [ ] **Step 4: Verify schema in dev DB**

Run: `cd apps/api && npx prisma db execute --stdin <<< "SELECT column_name FROM information_schema.columns WHERE table_name='pricing_templates' AND column_name LIKE 'rate%';"`
Expected: 4 rows back (`rate1_down_payment`, `rate1_term_months`, `rate2_down_payment`, `rate2_term_months`)

Run: `cd apps/api && npx prisma db execute --stdin <<< "SELECT key, value FROM system_configs WHERE key LIKE 'sticker.%' ORDER BY key;"`
Expected: 4 rows with default values (0, 24, 0, 12)

- [ ] **Step 5: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors. (Prisma Client regen should expose new fields automatically.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260807100000_sticker_pricing_rates
git commit -m "feat(stickers): add rate1/rate2 fields to PricingTemplate + seed defaults"
```

---

## Task 2: Backend — extend `StickersService.getStickerData` + tests

**Files:**
- Modify: `apps/api/src/modules/stickers/stickers.service.ts`
- Create: `apps/api/src/modules/stickers/stickers.service.spec.ts`

- [ ] **Step 1: Write failing tests first**

Create `apps/api/src/modules/stickers/stickers.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { StickersService } from './stickers.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StickersService.getStickerData', () => {
  let service: StickersService;
  let prisma: {
    product: { findUnique: jest.Mock };
    pricingTemplate: { findFirst: jest.Mock };
    systemConfig: { findMany: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      pricingTemplate: { findFirst: jest.fn() },
      systemConfig: { findMany: jest.fn() },
      companyInfo: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [StickersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(StickersService);
  });

  const baseProduct = {
    id: 'product-1',
    brand: 'Apple',
    model: 'iPhone 15 Pro Max',
    color: 'ดำ',
    storage: '256GB',
    batteryHealth: 95,
    warrantyExpireDate: new Date('2027-05-22'),
    warrantyExpired: false,
    imeiSerial: '359123456789012',
    category: 'PHONE_NEW' as const,
    branch: { name: 'สาขาลาดพร้าว' },
    inspection: null,
  };

  const defaultConfigs = [
    { key: 'sticker.rate1.defaultDown', value: '0' },
    { key: 'sticker.rate1.defaultTerm', value: '24' },
    { key: 'sticker.rate2.defaultDown', value: '0' },
    { key: 'sticker.rate2.defaultTerm', value: '12' },
  ];

  const fullPricingTemplate = {
    cashPrice: new Decimal(35900),
    installmentBestchoicePrice: new Decimal(1500),
    installmentFinancePrice: new Decimal(1800),
    rate1DownPayment: null,
    rate1TermMonths: null,
    rate2DownPayment: null,
    rate2TermMonths: null,
    hasWarranty: false,
  };

  it('returns full sticker data with PricingTemplate match using SystemConfig fallbacks', async () => {
    prisma.product.findUnique.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue({ logoUrl: 'https://cdn/logo.png' });

    const result = await service.getStickerData('product-1');

    expect(result).toMatchObject({
      productId: 'product-1',
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      color: 'ดำ',
      storage: '256GB',
      batteryHealth: 95,
      warrantyExpireDate: '2027-05-22',
      imei: '359123456789012',
      cashPrice: 35900,
      rate1: { downPayment: 0, monthlyPrice: 1500, termMonths: 24 },
      rate2: { downPayment: 0, monthlyPrice: 1800, termMonths: 12 },
      shopLogoUrl: 'https://cdn/logo.png',
    });
  });

  it('uses PricingTemplate rate overrides when set (not fallback)', async () => {
    prisma.product.findUnique.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue({
      ...fullPricingTemplate,
      rate1DownPayment: new Decimal(2000),
      rate1TermMonths: 36,
    });
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.rate1).toEqual({ downPayment: 2000, monthlyPrice: 1500, termMonths: 36 });
    expect(result.rate2).toEqual({ downPayment: 0, monthlyPrice: 1800, termMonths: 12 });
  });

  it('hides cashPrice + rates when no PricingTemplate matches', async () => {
    prisma.product.findUnique.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue(null);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.cashPrice).toBeNull();
    expect(result.rate1).toBeNull();
    expect(result.rate2).toBeNull();
    expect(result.brand).toBe('Apple');
  });

  it('returns null for warrantyExpireDate when warrantyExpired = true', async () => {
    prisma.product.findUnique.mockResolvedValue({ ...baseProduct, warrantyExpired: true });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.warrantyExpireDate).toBeNull();
  });

  it('returns null for warrantyExpireDate when expire date is in the past', async () => {
    prisma.product.findUnique.mockResolvedValue({
      ...baseProduct,
      warrantyExpireDate: new Date('2024-01-01'),
      warrantyExpired: false,
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.warrantyExpireDate).toBeNull();
  });

  it('returns null fields for missing battery/IMEI/color/storage', async () => {
    prisma.product.findUnique.mockResolvedValue({
      ...baseProduct,
      color: null,
      storage: null,
      batteryHealth: null,
      imeiSerial: null,
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.color).toBeNull();
    expect(result.storage).toBeNull();
    expect(result.batteryHealth).toBeNull();
    expect(result.imei).toBeNull();
  });

  it('throws NotFoundException when product not found', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.getStickerData('missing-id')).rejects.toThrow('ไม่พบสินค้า');
  });
});

describe('StickersService.getStickerDataBatch', () => {
  let service: StickersService;
  let prisma: {
    product: { findUnique: jest.Mock };
    pricingTemplate: { findFirst: jest.Mock };
    systemConfig: { findMany: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      pricingTemplate: { findFirst: jest.fn() },
      systemConfig: { findMany: jest.fn() },
      companyInfo: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [StickersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(StickersService);
  });

  it('returns array of sticker data for given product ids, skipping missing', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'sticker.rate1.defaultDown', value: '0' },
      { key: 'sticker.rate1.defaultTerm', value: '24' },
      { key: 'sticker.rate2.defaultDown', value: '0' },
      { key: 'sticker.rate2.defaultTerm', value: '12' },
    ]);
    prisma.companyInfo.findFirst.mockResolvedValue(null);
    prisma.product.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 'p1') {
        return Promise.resolve({
          id: 'p1', brand: 'Apple', model: 'iPhone 15', color: null, storage: null,
          batteryHealth: null, warrantyExpireDate: null, warrantyExpired: null,
          imeiSerial: null, category: 'PHONE_NEW', branch: { name: 'X' }, inspection: null,
        });
      }
      return Promise.resolve(null); // p2 missing
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(null);

    const result = await service.getStickerDataBatch(['p1', 'p2']);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npm test -- stickers.service.spec --runInBand`
Expected: FAIL — `getStickerData` returns old shape; `getStickerDataBatch` doesn't exist.

- [ ] **Step 3: Replace `stickers.service.ts` with new implementation**

Replace entire content of `apps/api/src/modules/stickers/stickers.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStickerTemplateDto, UpdateStickerTemplateDto } from './dto/sticker.dto';

export interface StickerRate {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

export interface StickerData {
  productId: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  batteryHealth: number | null;
  warrantyExpireDate: string | null; // ISO date YYYY-MM-DD or null
  imei: string | null;
  cashPrice: number | null;
  rate1: StickerRate | null;
  rate2: StickerRate | null;
  shopLogoUrl: string | null;
}

interface StickerDefaults {
  rate1Down: number;
  rate1Term: number;
  rate2Down: number;
  rate2Term: number;
}

@Injectable()
export class StickersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    page = Math.max(1, page);
    limit = Math.min(200, Math.max(1, limit));

    const [data, total] = await Promise.all([
      this.prisma.stickerTemplate.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stickerTemplate.count({ where: { deletedAt: null } }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const template = await this.prisma.stickerTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบ Template สติกเกอร์');
    return template;
  }

  async create(dto: CreateStickerTemplateDto) {
    return this.prisma.stickerTemplate.create({ data: dto as Prisma.StickerTemplateCreateInput });
  }

  async update(id: string, dto: UpdateStickerTemplateDto) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({ where: { id }, data: dto as Prisma.StickerTemplateUpdateInput });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({ where: { id }, data: { isActive: false } });
  }

  async getStickerData(productId: string): Promise<StickerData> {
    const [defaults, shopLogoUrl] = await Promise.all([
      this.loadDefaults(),
      this.loadShopLogoUrl(),
    ]);
    const data = await this.composeOne(productId, defaults, shopLogoUrl);
    if (!data) throw new NotFoundException('ไม่พบสินค้า');
    return data;
  }

  async getStickerDataBatch(productIds: string[]): Promise<StickerData[]> {
    if (productIds.length === 0) return [];
    const [defaults, shopLogoUrl] = await Promise.all([
      this.loadDefaults(),
      this.loadShopLogoUrl(),
    ]);
    const results = await Promise.all(
      productIds.map((id) => this.composeOne(id, defaults, shopLogoUrl)),
    );
    return results.filter((r): r is StickerData => r !== null);
  }

  private async loadDefaults(): Promise<StickerDefaults> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'sticker.' } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
      rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
      rate2Down: Number(map.get('sticker.rate2.defaultDown') ?? 0),
      rate2Term: Number(map.get('sticker.rate2.defaultTerm') ?? 12),
    };
  }

  private async loadShopLogoUrl(): Promise<string | null> {
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP' },
      select: { logoUrl: true },
    });
    return company?.logoUrl ?? null;
  }

  private async composeOne(
    productId: string,
    defaults: StickerDefaults,
    shopLogoUrl: string | null,
  ): Promise<StickerData | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        branch: { select: { name: true } },
        inspection: { select: { overallGrade: true, gradeOverride: true } },
      },
    });
    if (!product) return null;

    const pricing = await this.prisma.pricingTemplate.findFirst({
      where: {
        brand: { equals: product.brand, mode: 'insensitive' },
        model: { equals: product.model, mode: 'insensitive' },
        storage: product.storage ?? '',
        category: product.category as ProductCategory,
        isActive: true,
        deletedAt: null,
      },
    });

    const warrantyExpireDate = this.computeWarranty(product.warrantyExpireDate, product.warrantyExpired);

    return {
      productId: product.id,
      brand: product.brand,
      model: product.model,
      color: product.color,
      storage: product.storage,
      batteryHealth: product.batteryHealth,
      warrantyExpireDate,
      imei: product.imeiSerial,
      cashPrice: pricing ? Number(pricing.cashPrice) : null,
      rate1: pricing
        ? {
            downPayment: pricing.rate1DownPayment !== null ? Number(pricing.rate1DownPayment) : defaults.rate1Down,
            monthlyPrice: Number(pricing.installmentBestchoicePrice),
            termMonths: pricing.rate1TermMonths ?? defaults.rate1Term,
          }
        : null,
      rate2: pricing
        ? {
            downPayment: pricing.rate2DownPayment !== null ? Number(pricing.rate2DownPayment) : defaults.rate2Down,
            monthlyPrice: Number(pricing.installmentFinancePrice),
            termMonths: pricing.rate2TermMonths ?? defaults.rate2Term,
          }
        : null,
      shopLogoUrl,
    };
  }

  private computeWarranty(expireDate: Date | null, expired: boolean | null): string | null {
    if (!expireDate) return null;
    if (expired === true) return null;
    if (expireDate.getTime() < Date.now()) return null;
    return expireDate.toISOString().slice(0, 10);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npm test -- stickers.service.spec --runInBand`
Expected: All tests PASS.

- [ ] **Step 5: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/stickers/stickers.service.ts apps/api/src/modules/stickers/stickers.service.spec.ts
git commit -m "feat(stickers): extend getStickerData with rates/warranty/logo + batch endpoint"
```

---

## Task 3: Backend — batch endpoint controller

**Files:**
- Modify: `apps/api/src/modules/stickers/stickers.controller.ts`

- [ ] **Step 1: Add batch endpoint to controller**

Open `apps/api/src/modules/stickers/stickers.controller.ts`. After the existing `getStickerData` method (around line 32), add:

```typescript
  @Get('products/data')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getStickerDataBatch(@Query('ids') ids?: string) {
    if (!ids) return [];
    const productIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
    return this.stickersService.getStickerDataBatch(productIds);
  }
```

The new method must be placed BEFORE the `@Get(':id')` route (NestJS matches in declaration order — `:id` would otherwise capture `products`).

- [ ] **Step 2: Manual smoke test**

Restart API. Run:

```bash
curl -s "http://localhost:3000/api/sticker-templates/products/data?ids=invalid-id-1,invalid-id-2" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: `[]` (empty array — no products match)

Then with a real product ID from your dev DB:

```bash
PRODUCT_ID=$(cd apps/api && npx prisma db execute --stdin <<< "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1;" 2>/dev/null | tail -1 | tr -d '[:space:]')
curl -s "http://localhost:3000/api/sticker-templates/products/data?ids=$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: array with 1 element matching `StickerData` shape.

- [ ] **Step 3: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/stickers/stickers.controller.ts
git commit -m "feat(stickers): add GET /sticker-templates/products/data batch endpoint"
```

---

## Task 4: Backend — extend PricingTemplate DTO + service

**Files:**
- Modify: `apps/api/src/modules/pricing-templates/dto/pricing-template.dto.ts`
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.service.ts`

- [ ] **Step 1: Add 4 fields to Create + Update DTOs**

Replace content of `apps/api/src/modules/pricing-templates/dto/pricing-template.dto.ts`:

```typescript
import { IsString, IsNumber, IsOptional, IsBoolean, IsEnum, IsInt, Min } from 'class-validator';

enum ProductCategory {
  PHONE_NEW = 'PHONE_NEW',
  PHONE_USED = 'PHONE_USED',
  TABLET = 'TABLET',
  ACCESSORY = 'ACCESSORY',
}

export class CreatePricingTemplateDto {
  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsEnum(ProductCategory, { message: 'หมวดหมู่สินค้าต้องเป็น PHONE_NEW, PHONE_USED, TABLET หรือ ACCESSORY' })
  category: ProductCategory;

  @IsBoolean()
  @IsOptional()
  hasWarranty?: boolean;

  @IsNumber()
  cashPrice: number;

  @IsNumber()
  installmentBestchoicePrice: number;

  @IsNumber()
  installmentFinancePrice: number;

  @IsNumber()
  @IsOptional()
  rate1DownPayment?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  rate1TermMonths?: number;

  @IsNumber()
  @IsOptional()
  rate2DownPayment?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  rate2TermMonths?: number;
}

export class UpdatePricingTemplateDto {
  @IsNumber()
  @IsOptional()
  cashPrice?: number;

  @IsNumber()
  @IsOptional()
  installmentBestchoicePrice?: number;

  @IsNumber()
  @IsOptional()
  installmentFinancePrice?: number;

  @IsNumber()
  @IsOptional()
  rate1DownPayment?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  rate1TermMonths?: number;

  @IsNumber()
  @IsOptional()
  rate2DownPayment?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  rate2TermMonths?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

- [ ] **Step 2: Persist new fields in service**

Open `apps/api/src/modules/pricing-templates/pricing-templates.service.ts`. Find the `create` method's `data: { ... }` block. Replace it to include new fields:

Find (around line 65-74):
```typescript
      return await this.prisma.pricingTemplate.create({
        data: {
          brand: dto.brand,
          model: dto.model,
          storage: dto.storage || '',
          category: dto.category as ProductCategory,
          hasWarranty: dto.category === 'PHONE_USED' ? (dto.hasWarranty ?? false) : false,
          cashPrice: dto.cashPrice,
          installmentBestchoicePrice: dto.installmentBestchoicePrice,
          installmentFinancePrice: dto.installmentFinancePrice,
        },
      });
```

Replace with:
```typescript
      return await this.prisma.pricingTemplate.create({
        data: {
          brand: dto.brand,
          model: dto.model,
          storage: dto.storage || '',
          category: dto.category as ProductCategory,
          hasWarranty: dto.category === 'PHONE_USED' ? (dto.hasWarranty ?? false) : false,
          cashPrice: dto.cashPrice,
          installmentBestchoicePrice: dto.installmentBestchoicePrice,
          installmentFinancePrice: dto.installmentFinancePrice,
          rate1DownPayment: dto.rate1DownPayment,
          rate1TermMonths: dto.rate1TermMonths,
          rate2DownPayment: dto.rate2DownPayment,
          rate2TermMonths: dto.rate2TermMonths,
        },
      });
```

Find the `update` method (search for `async update(id: string, dto: UpdatePricingTemplateDto)`). The current implementation likely passes `dto` directly to Prisma `update`. Verify it does — if so, no change needed (Prisma accepts the new optional fields automatically). If it cherry-picks fields manually, add the 4 new fields.

- [ ] **Step 3: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 4: Manual smoke test**

```bash
curl -s -X POST http://localhost:3000/api/pricing-templates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"brand":"Apple","model":"iPhone 15 Pro Max","storage":"256GB","category":"PHONE_NEW","cashPrice":35900,"installmentBestchoicePrice":1500,"installmentFinancePrice":1800,"rate1DownPayment":0,"rate1TermMonths":24,"rate2DownPayment":1000,"rate2TermMonths":12}' | jq .
```

Expected: 201 with template containing all 4 new fields populated.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pricing-templates/dto/pricing-template.dto.ts apps/api/src/modules/pricing-templates/pricing-templates.service.ts
git commit -m "feat(pricing-templates): accept rate1/rate2 down + term fields"
```

---

## Task 5: Frontend — redesign `/stickers` page

**Files:**
- Replace: `apps/web/src/pages/StickerPrintPage.tsx`

- [ ] **Step 1: Replace entire file**

Replace content of `apps/web/src/pages/StickerPrintPage.tsx`:

```typescript
import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer, Plus, X } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';

interface StickerRate {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

interface StickerData {
  productId: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  batteryHealth: number | null;
  warrantyExpireDate: string | null;
  imei: string | null;
  cashPrice: number | null;
  rate1: StickerRate | null;
  rate2: StickerRate | null;
  shopLogoUrl: string | null;
}

interface PrintItem {
  productId: string;
  qty: number;
}

function formatThaiDate(isoDate: string): string {
  // YYYY-MM-DD → DD/MM/YYYY (ค.ศ.)
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function formatBaht(n: number): string {
  return n.toLocaleString('th-TH');
}

function StickerCard({ data }: { data: StickerData }) {
  const specParts = [data.color, data.storage, data.batteryHealth !== null ? `แบต ${data.batteryHealth}%` : null].filter(Boolean);
  const warrantyText = data.warrantyExpireDate ? `ประกันศูนย์ ${formatThaiDate(data.warrantyExpireDate)}` : null;

  return (
    <div className="sticker bg-white text-black relative overflow-hidden border border-dashed border-border print:border-0">
      <div className="flex justify-between items-start gap-1">
        <div className="font-bold text-[8pt] leading-tight truncate">
          {data.brand} {data.model}
        </div>
        {data.cashPrice !== null && (
          <div className="font-bold text-[9pt] leading-tight whitespace-nowrap">
            ฿ {formatBaht(data.cashPrice)}
          </div>
        )}
      </div>

      <div className="flex justify-between items-start gap-1 text-[6.5pt] leading-tight mt-[0.5mm]">
        <div className="truncate">{specParts.join(' · ') || ' '}</div>
        {warrantyText && <div className="whitespace-nowrap">{warrantyText}</div>}
      </div>

      <hr className="my-[0.8mm] border-t border-black/40" />

      {data.rate1 && (
        <div className="text-[6.5pt] leading-tight tabular-nums">
          เรทที่ 1  ดาวน์ {formatBaht(data.rate1.downPayment)}  {formatBaht(data.rate1.monthlyPrice)} × {data.rate1.termMonths} ด.
        </div>
      )}
      {data.rate2 && (
        <div className="text-[6.5pt] leading-tight tabular-nums">
          เรทที่ 2  ดาวน์ {formatBaht(data.rate2.downPayment)}  {formatBaht(data.rate2.monthlyPrice)} × {data.rate2.termMonths} ด.
        </div>
      )}

      <div className="absolute left-[1mm] right-[8mm] bottom-[0.5mm] text-[6pt] font-mono leading-none truncate">
        {data.imei ? `IMEI: ${data.imei}` : ' '}
      </div>

      {data.shopLogoUrl && (
        <img
          src={data.shopLogoUrl}
          alt=""
          className="absolute right-[1mm] bottom-[1mm] w-[7mm] h-[7mm] object-contain"
        />
      )}
    </div>
  );
}

export default function StickerPrintPage() {
  const [searchParams] = useSearchParams();
  const idsFromUrl = searchParams.get('productIds');

  const [items, setItems] = useState<PrintItem[]>([]);
  const [manualId, setManualId] = useState('');

  // Initialize from URL once on mount
  useEffect(() => {
    if (idsFromUrl) {
      const initial = idsFromUrl
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({ productId: id, qty: 1 }));
      setItems(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productIdsKey = useMemo(() => items.map((i) => i.productId).sort().join(','), [items]);

  const {
    data: stickerData = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<StickerData[]>({
    queryKey: ['sticker-data', productIdsKey],
    queryFn: async () => {
      if (items.length === 0) return [];
      const ids = items.map((i) => i.productId).join(',');
      const res = await api.get(`/sticker-templates/products/data?ids=${encodeURIComponent(ids)}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: items.length > 0,
  });

  // Build flat list expanded by qty, in user's input order
  const expandedStickers = useMemo(() => {
    const dataMap = new Map(stickerData.map((d) => [d.productId, d]));
    const out: StickerData[] = [];
    for (const item of items) {
      const data = dataMap.get(item.productId);
      if (!data) continue;
      for (let i = 0; i < item.qty; i++) out.push(data);
    }
    return out;
  }, [items, stickerData]);

  const addManual = () => {
    const id = manualId.trim();
    if (!id) return;
    if (items.some((i) => i.productId === id)) {
      setManualId('');
      return;
    }
    setItems([...items, { productId: id, qty: 1 }]);
    setManualId('');
  };

  const updateQty = (productId: string, qty: number) => {
    setItems(items.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, qty) } : i)));
  };

  const removeItem = (productId: string) => {
    setItems(items.filter((i) => i.productId !== productId));
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="พิมพ์สติกเกอร์" subtitle="สติกเกอร์ติดเครื่อง 50×30mm สำหรับเครื่องพิมพ์ thermal" />

        <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6 mb-6 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
              placeholder="วาง Product ID หรือ scan barcode แล้วกด Enter"
              className="flex-1 px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring"
            />
            <Button onClick={addManual} disabled={!manualId.trim()} variant="outline">
              <Plus className="size-4 mr-1" /> เพิ่ม
            </Button>
            <Button onClick={handlePrint} disabled={expandedStickers.length === 0}>
              <Printer className="size-4 mr-1" /> พิมพ์ ({expandedStickers.length} ดวง)
            </Button>
          </div>

          {items.length > 0 && (
            <div className="space-y-1">
              {items.map((item) => {
                const data = stickerData.find((d) => d.productId === item.productId);
                return (
                  <div key={item.productId} className="flex items-center gap-2 text-sm py-1 border-b border-border/30 last:border-0">
                    <div className="flex-1 truncate">
                      {data ? `${data.brand} ${data.model}` : <span className="text-muted-foreground">{item.productId}</span>}
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => updateQty(item.productId, parseInt(e.target.value) || 1)}
                      className="w-16 px-2 py-1 border border-input rounded text-sm text-center"
                    />
                    <span className="text-xs text-muted-foreground">ดวง</span>
                    <button
                      onClick={() => removeItem(item.productId)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="ลบ"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="โหลดข้อมูลสติกเกอร์ไม่สำเร็จ"
        >
          {expandedStickers.length === 0 && items.length > 0 && (
            <div className="text-center text-muted-foreground py-8">ไม่พบสินค้าตาม ID ที่ระบุ</div>
          )}
        </QueryBoundary>
      </div>

      {/* Preview / Print area */}
      <div className="print-stickers flex flex-wrap gap-2 print:gap-0 print:block justify-center">
        {expandedStickers.map((data, idx) => (
          <StickerCard key={`${data.productId}-${idx}`} data={data} />
        ))}
      </div>

      <style>{`
        .sticker {
          width: 50mm;
          height: 30mm;
          padding: 1mm 1.5mm;
          font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
          box-sizing: border-box;
        }
        @media print {
          @page { size: 50mm 30mm; margin: 0; }
          body { margin: 0; padding: 0; background: white; }
          .print\\:hidden { display: none !important; }
          .sticker {
            page-break-after: always;
            border: 0 !important;
            margin: 0;
          }
          .sticker:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 3: Manual UI test**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:5173/stickers`. Steps:
1. Paste a real product UUID (from `/stock` URL or DB) → press Enter → row appears, sticker preview renders
2. Add 2 more products → see 3 stickers in preview
3. Change qty of one to `3` → see 5 stickers total in preview (1+1+3)
4. Click "พิมพ์" → browser print dialog shows 5 pages × 50×30mm
5. Cancel print, remove a row → sticker disappears immediately
6. Open `http://localhost:5173/stickers?productIds=id1,id2,id3` → 3 stickers preload

Expected: stickers render with rุ่น (bold), price (bold right), spec line, warranty date, both rate lines (when PricingTemplate exists), IMEI bottom-left, logo bottom-right corner

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/StickerPrintPage.tsx
git commit -m "feat(stickers/web): redesign /stickers as 50x30mm thermal print with bulk list"
```

---

## Task 6: Frontend — Stock bulk action

**Files:**
- Modify: `apps/web/src/pages/StockPage/index.tsx`
- Modify: `apps/web/src/pages/StockPage/components/StockListTab.tsx`

- [ ] **Step 1: Read current StockPage to understand DataTable usage**

Run: `grep -n "DataTable\|selectable\|columns" apps/web/src/pages/StockPage/index.tsx | head -20`
Run: `grep -n "DataTable\|selectable\|columns" apps/web/src/pages/StockPage/components/StockListTab.tsx | head -20`

Note where `<DataTable>` is rendered (in StockListTab) and which file holds the column definitions.

- [ ] **Step 2: Add bulk action plumbing**

In `apps/web/src/pages/StockPage/components/StockListTab.tsx`:

(a) Import:
```typescript
import { Printer } from 'lucide-react';
import { useNavigate } from 'react-router';
```

(b) Inside the component, add:
```typescript
const navigate = useNavigate();
```

(c) Find the `<DataTable>` render. Add these props:
```tsx
<DataTable
  data={listProducts}
  columns={columns}
  selectable
  bulkActions={[
    {
      label: 'พิมพ์สติกเกอร์',
      icon: <Printer className="size-4" />,
      onAction: (selected: StockProduct[]) => {
        const ids = selected.map((p) => p.id).join(',');
        navigate(`/stickers?productIds=${encodeURIComponent(ids)}`);
      },
    },
  ]}
  // ...rest of existing props
/>
```

If the existing DataTable doesn't expose `selectable`/`bulkActions` directly (verify by reading `apps/web/src/components/ui/DataTable.tsx`), match the prop names already supported (the file does have `selectable` + `BulkAction` based on grep above). Check the BulkAction type:

```bash
grep -n "BulkAction\|bulkActions\|type Bulk" apps/web/src/components/ui/DataTable.tsx
```

Use the exact type signature from the source.

- [ ] **Step 3: Type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 4: Manual UI test**

Open `/stock`. Steps:
1. Tick checkboxes for 3 products → bulk-action toolbar appears
2. Click "พิมพ์สติกเกอร์" → navigates to `/stickers?productIds=...`
3. Stickers page renders 3 stickers with correct data

Expected: navigation works, stickers preload from URL.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/StockPage/components/StockListTab.tsx apps/web/src/pages/StockPage/index.tsx
git commit -m "feat(stock/web): add bulk-print sticker action in stock list"
```

---

## Task 7: Frontend — Settings sticker defaults section

**Files:**
- Create: `apps/web/src/pages/SettingsPage/components/StickerSettings.tsx`
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`

- [ ] **Step 1: Read existing pattern**

Read `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` (or `GeneralSettings.tsx`) to copy the editing pattern (uses `values`, `editingSection`, `handleEdit`, `handleSave`).

Also read `apps/web/src/pages/SettingsPage/components/shared.tsx` to understand `ConfigItem` shape.

- [ ] **Step 2: Create `StickerSettings.tsx`**

Create `apps/web/src/pages/SettingsPage/components/StickerSettings.tsx`:

```typescript
import { useAuth } from '@/contexts/AuthContext';
import type { ConfigItem } from './shared';

interface Props {
  configs: ConfigItem[];
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  editingSection: string | null;
  onEdit: (section: string) => void;
  onSave: (keys: string[]) => void;
  onCancel: () => void;
  saving: boolean;
}

const FIELDS = [
  { key: 'sticker.rate1.defaultDown', label: 'ดาวน์เรทที่ 1 default (บาท)', placeholder: '0' },
  { key: 'sticker.rate1.defaultTerm', label: 'จำนวนเดือนเรทที่ 1 default', placeholder: '24' },
  { key: 'sticker.rate2.defaultDown', label: 'ดาวน์เรทที่ 2 default (บาท)', placeholder: '0' },
  { key: 'sticker.rate2.defaultTerm', label: 'จำนวนเดือนเรทที่ 2 default', placeholder: '12' },
] as const;

const SECTION_KEY = 'sticker';

export default function StickerSettings({
  configs,
  values,
  setValues,
  editingSection,
  onEdit,
  onSave,
  onCancel,
  saving,
}: Props) {
  const { user } = useAuth();
  if (user?.role !== 'OWNER') return null;

  const isEditing = editingSection === SECTION_KEY;
  const currentValue = (key: string) =>
    isEditing ? (values[key] ?? '') : (configs.find((c) => c.key === key)?.value ?? '');

  return (
    <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">ค่า default สติกเกอร์ติดเครื่อง</h2>
        {!isEditing ? (
          <button
            onClick={() => onEdit(SECTION_KEY)}
            className="text-sm text-primary hover:underline"
          >
            แก้ไข
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={saving}
              className="text-sm text-muted-foreground hover:underline"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => onSave(FIELDS.map((f) => f.key))}
              disabled={saving}
              className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              บันทึก
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        ใช้เมื่อ PricingTemplate ของรุ่นนั้นไม่ได้ override ดาวน์/จำนวนเดือน
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium mb-1">{field.label}</label>
            <input
              type="number"
              min={0}
              value={currentValue(field.key)}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              placeholder={field.placeholder}
              disabled={!isEditing}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring disabled:bg-muted disabled:cursor-not-allowed"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount in SettingsPage**

Open `apps/web/src/pages/SettingsPage/index.tsx`.

(a) Add import near top with other component imports:
```typescript
import StickerSettings from './components/StickerSettings';
```

(b) Find where the existing settings sections are rendered (look for `<SystemSettings`, `<CompanySettings`, etc.). Add inside the same parent:
```tsx
<StickerSettings
  configs={configs}
  values={values}
  setValues={setValues}
  editingSection={editingSection}
  onEdit={handleEdit}
  onSave={(keys) => {
    const items = keys
      .filter((k) => values[k] !== undefined)
      .map((k) => ({ key: k, value: String(values[k]) }));
    saveMutation.mutate(items);
  }}
  onCancel={() => setEditingSection(null)}
  saving={saveMutation.isPending}
/>
```

If the existing components use a different pattern (e.g. take a section-scoped subset of `configs`), match that pattern instead — read `<SystemSettings>` component invocation in the same file and adapt.

- [ ] **Step 4: Type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 5: Manual UI test**

Login as OWNER. Open `/settings`. Steps:
1. Find new section "ค่า default สติกเกอร์ติดเครื่อง" → 4 inputs displayed disabled
2. Click "แก้ไข" → inputs enabled
3. Set rate1.defaultDown = 1500, rate1.defaultTerm = 36
4. Click "บันทึก" → toast "บันทึกสำเร็จ"
5. Reload page → values persist
6. Open `/stickers?productIds=<some-id>` for a product whose PricingTemplate has `rate1DownPayment = NULL` → preview shows down 1,500 × 36 ด

Login as SALES. Open `/settings`. Expected: section is NOT visible (OWNER-only).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/SettingsPage/components/StickerSettings.tsx apps/web/src/pages/SettingsPage/index.tsx
git commit -m "feat(settings/web): add sticker rate defaults section (OWNER only)"
```

---

## Task 8: Frontend — PricingTemplate form 4 new fields

**Files:**
- Modify: `apps/web/src/pages/PricingTemplatesPage.tsx`

- [ ] **Step 1: Read current form structure**

Read `apps/web/src/pages/PricingTemplatesPage.tsx` end-to-end. Identify:
- The state shape for create/edit form (likely a useState object)
- Where `cashPrice`, `installmentBestchoicePrice`, `installmentFinancePrice` inputs are rendered
- The submit handler that POSTs to `/api/pricing-templates`

- [ ] **Step 2: Add 4 form fields**

After the existing `installmentFinancePrice` input, add 4 new inputs grouped into a labeled section:

```tsx
<div className="md:col-span-2 mt-4 pt-4 border-t border-border/40">
  <h3 className="text-sm font-medium text-muted-foreground mb-3">
    ดาวน์ + จำนวนเดือน (เว้นว่าง = ใช้ default จาก Settings)
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label className="block text-sm font-medium mb-1">ดาวน์เรทที่ 1 (บาท)</label>
      <input
        type="number"
        min={0}
        value={form.rate1DownPayment ?? ''}
        onChange={(e) => setForm({ ...form, rate1DownPayment: e.target.value === '' ? undefined : Number(e.target.value) })}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm"
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-1">จำนวนเดือนเรทที่ 1</label>
      <input
        type="number"
        min={1}
        value={form.rate1TermMonths ?? ''}
        onChange={(e) => setForm({ ...form, rate1TermMonths: e.target.value === '' ? undefined : Number(e.target.value) })}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm"
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-1">ดาวน์เรทที่ 2 (บาท)</label>
      <input
        type="number"
        min={0}
        value={form.rate2DownPayment ?? ''}
        onChange={(e) => setForm({ ...form, rate2DownPayment: e.target.value === '' ? undefined : Number(e.target.value) })}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm"
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-1">จำนวนเดือนเรทที่ 2</label>
      <input
        type="number"
        min={1}
        value={form.rate2TermMonths ?? ''}
        onChange={(e) => setForm({ ...form, rate2TermMonths: e.target.value === '' ? undefined : Number(e.target.value) })}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm"
      />
    </div>
  </div>
</div>
```

Adapt prop names (`form`, `setForm`) to the actual state names in the file. Update the form's TypeScript interface to add 4 optional fields:

```typescript
rate1DownPayment?: number;
rate1TermMonths?: number;
rate2DownPayment?: number;
rate2TermMonths?: number;
```

If the form state is initialized with default values, ensure these 4 fields default to `undefined` (not `0`) so empty inputs don't get coerced.

The existing submit handler likely already passes the entire form to the API — Prisma will accept the new fields automatically. If the handler explicitly cherry-picks fields, add the 4 new ones.

- [ ] **Step 3: Edit-mode population**

When the user clicks "แก้ไข" on an existing template, the form must populate the 4 new fields from the API response. Find the edit-init logic (search for "edit" or `setForm(...template)` in the file) and add the 4 fields to the populated object.

- [ ] **Step 4: Type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 5: Manual UI test**

Open `/settings/pricing-templates`. Steps:
1. Click "เพิ่มราคาตั้งต้น" → form opens → 4 new inputs visible at the bottom under "ดาวน์ + จำนวนเดือน"
2. Fill all required fields + leave rate fields empty → save → success
3. Edit the just-created row → 4 rate fields are empty (null persists as empty)
4. Set rate1DownPayment = 2000, rate1TermMonths = 36 → save → success
5. Open `/stickers?productIds=<that-product-id>` → preview shows "เรทที่ 1 ดาวน์ 2,000 ... × 36 ด"

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/PricingTemplatesPage.tsx
git commit -m "feat(pricing-templates/web): add rate1/rate2 down + term inputs"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors across api + web.

- [ ] **Step 2: Run API tests**

Run: `cd apps/api && npm test --runInBand`
Expected: all suites pass, including new `stickers.service.spec.ts`.

- [ ] **Step 3: Lint web**

Run: `cd apps/web && npm run lint`
Expected: 0 errors (warnings okay).

- [ ] **Step 4: End-to-end manual smoke**

With API + web both running:

1. Login as OWNER
2. Go to `/settings` → set sticker rate defaults (rate1: 0/24, rate2: 1000/12) → save
3. Go to `/settings/pricing-templates` → create template for "Apple iPhone 15 Pro Max 256GB PHONE_NEW" with cashPrice=35900, installmentBestchoicePrice=1500, installmentFinancePrice=1800, leave 4 new rate fields empty
4. Go to `/stock` → create or find a product matching "Apple / iPhone 15 Pro Max / 256GB" with batteryHealth=95, warrantyExpireDate=2027-05-22, imeiSerial=359123456789012
5. From `/stock`, tick checkbox for that product → click "พิมพ์สติกเกอร์" → opens `/stickers?productIds=...`
6. Preview should match spec layout exactly (รุ่น+ราคาบนสุด, สเปค+ประกัน, เรท1+เรท2, IMEI+โลโก้ล่าง)
7. Click "พิมพ์" → browser print preview shows 50×30mm with no chrome
8. Cancel → go back to `/stock`, select 3 products → bulk print → preview shows 3 stickers
9. Change qty of one to `3` → preview shows 5 stickers total
10. Edit PricingTemplate → set rate1TermMonths=36 → reopen `/stickers` → preview reflects 36 ด.

- [ ] **Step 5: Commit final fixes (if any)**

If steps revealed bugs, fix and commit. Otherwise, no commit needed.

---

## Self-Review Checklist (filled by author)

**Spec coverage:**
- ✅ Layout 50×30mm with logo bottom-right (Task 5)
- ✅ Fields: รุ่น, สี/ความจุ/แบต, ประกันวันที่หมด, IMEI, ราคา, 2 เรท (Task 5)
- ✅ Schema migration + 4 cols + SystemConfig seed (Task 1)
- ✅ Backend extend `getStickerData` + batch + tests (Task 2, 3)
- ✅ PricingTemplate accepts new fields (Task 4)
- ✅ `/stickers` redesign + bulk list + qty (Task 5)
- ✅ `/stock` bulk action (Task 6)
- ✅ `/settings` sticker defaults section (Task 7)
- ✅ `/settings/pricing-templates` 4 form fields (Task 8)
- ✅ Print CSS @page 50×30mm + page-break (Task 5)
- ✅ Hide warranty when null/expired/past-date (Task 2 logic + Task 5 conditional)
- ✅ Hide cashPrice + rates when no PricingTemplate (Task 2 + Task 5 conditional)

**Placeholder scan:** No "TBD"/"TODO"/"implement later". All code is concrete.

**Type consistency:** `StickerData` shape declared in Task 2 `stickers.service.ts` and reused (manually duplicated) in Task 5 `StickerPrintPage.tsx` — both match. `StickerRate` consistent across both.

**Open implementation question:** Step 3 of Task 6 says "verify BulkAction prop name in DataTable" — engineer must read `DataTable.tsx` to confirm exact API. Plan provides fallback path if signature differs.
