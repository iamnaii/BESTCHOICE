# Web-shop iPhone-only + มือ 1/มือ 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้หน้าร้านออนไลน์ `/products` ขายเฉพาะ iPhone, แยก/กรองมือ 1 (ใหม่) กับ มือ 2 (มือสอง) ได้ และเลิกโชว์ราคาต้นทุน (costPrice) ให้ลูกค้าเห็น

**Architecture:** ไม่มี schema change — ใช้ `Product.category` (PHONE_NEW/PHONE_USED) เป็นแกน "มือ 1/มือ 2" และ `Product.cashPrice`/`installmentPrice` เป็นราคาขาย. Backend (`shop-catalog`) บังคับ iPhone-only + group by category + เปลี่ยนฐานราคาเป็น cashPrice; frontend (`apps/web-shop`) เพิ่มตัวกรองสภาพเครื่อง + ป้ายบนการ์ด + แก้หน้า detail + คำโฆษณา

**Tech Stack:** NestJS + Prisma (api, jest mock-prisma tests) · React + Vite + React Query + Tailwind (web-shop)

## Global Constraints

- **ห้ามแก้ schema / ไม่มี migration** — ใช้ field `category`, `cashPrice`, `installmentPrice` ที่มีอยู่แล้ว
- **`costPrice` ต้องไม่ปรากฏใน response ของ shop-catalog เด็ดขาด** (public + margin-sensitive)
- คำศัพท์ public: `NEW` = "มือ 1", `USED` = "มือ 2" (enum ภายในคือ `PHONE_NEW`/`PHONE_USED`)
- iPhone-only = `brand: 'Apple'` **และ** `category ∈ {PHONE_NEW, PHONE_USED}` (ตัด iPad/AirPods/accessory ด้วย)
- Money: แปลงด้วย `Number(Decimal)` ตาม pattern เดิมใน service
- UI text ภาษาไทย, Thai ใช้ `leading-snug`; web-shop ใช้สไตล์เดิม (emerald/zinc/cta) ไม่ใช่ design-token ของแอป admin
- api tests = jest แบบ mock PrismaService (ดู `shop-catalog.service.spec.ts` เดิม); frontend verify = `tsc` + `build` เขียว
- คำสั่งรันจาก root repo: api tests = `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts`

---

### Task 1: DTO — เพิ่ม param `condition`

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts`

**Interfaces:**
- Produces: `ListProductsDto.condition?: 'NEW' | 'USED'` (ไหลเข้า `listGroupedByModel(filters)` ตรงๆ เพราะ controller ส่ง `query` เข้า service)

- [ ] **Step 1: เพิ่ม field `condition` ใน DTO**

แก้ import บรรทัดแรกให้มี `IsIn` และเพิ่ม field ต่อจาก `brand`:

```ts
import { IsOptional, IsString, IsInt, Min, Max, MaxLength, IsIn } from 'class-validator';
```

เพิ่มหลัง `brand?: string;`:

```ts
  @IsOptional() @IsIn(['NEW', 'USED'])
  condition?: 'NEW' | 'USED';
```

(หมายเหตุ: DTO เดิมใช้ `@IsEnum([...])` กับ `sort` — คงไว้ตามเดิม, ใช้ `@IsIn` กับ `condition` เพื่อ validate ค่าลิเทอรัล)

- [ ] **Step 2: tsc เขียว**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: ไม่มี error ใหม่จากไฟล์นี้

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shop-catalog/dto/list-products.dto.ts
git commit -m "feat(shop-catalog): add condition (NEW/USED) query param to ListProductsDto"
```

---

### Task 2: Service `listGroupedByModel` — iPhone-only + group by category + condition + ฐานราคา cashPrice

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- Test: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts`

**Interfaces:**
- Consumes: `filters.condition?: 'NEW' | 'USED'` (Task 1)
- Produces:
  - `ProductGroup.condition: 'NEW' | 'USED'` (field ใหม่)
  - `ProductGroup.minPrice: number | null` (เปลี่ยนจาก `number` — null = ยังไม่ตั้งราคาขาย)
  - module constants `SHOP_BRAND = 'Apple'`, `PHONE_CATEGORIES = ['PHONE_NEW','PHONE_USED']`

- [ ] **Step 1: เขียน/แก้ test ให้ล้มก่อน (iPhone-only where + group key + cashPrice + condition)**

แทนที่ทั้ง `describe('listGroupedByModel', ...)` block เดิม (บรรทัด 24-91) ด้วยชุดนี้ — สังเกตว่า mock ใช้ `cashPrice` แทน `costPrice`:

```ts
  describe('listGroupedByModel', () => {
    it('hard-filters to iPhone only (brand=Apple AND category in phone set)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['brand', 'model', 'storage', 'category'],
          where: expect.objectContaining({
            brand: 'Apple',
            category: { in: ['PHONE_NEW', 'PHONE_USED'] },
            isOnlineVisible: true,
            status: 'IN_STOCK',
            deletedAt: null,
          }),
        }),
      );
    });

    it('narrows category to PHONE_NEW when condition=NEW', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'NEW' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_NEW');
    });

    it('narrows category to PHONE_USED when condition=USED', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'USED' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_USED');
    });

    it('groups by category so new+used of same model are separate cards, with condition + cashPrice', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW', _min: { cashPrice: 29900 }, _count: { id: 3 } },
        { brand: 'Apple', model: 'iPhone 16', storage: '128GB', category: 'PHONE_USED', _min: { cashPrice: 19900 }, _count: { id: 2 } },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: ['u'], conditionGrade: null });

      const result = await service.listGroupedByModel({});

      expect(result.data).toHaveLength(2);
      expect(result.data[0].condition).toBe('NEW');
      expect(result.data[0].minPrice).toBe(29900);
      expect(result.data[1].condition).toBe('USED');
      expect(result.data[1].minPrice).toBe(19900);
    });

    it('uses cashPrice (not costPrice) for min/sort and never leaks costPrice', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 15', storage: null, category: 'PHONE_USED', _min: { cashPrice: 16900 }, _count: { id: 1 } },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });

      const result = await service.listGroupedByModel({ sort: 'price_asc' });

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ _min: { cashPrice: true } }),
      );
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { cashPrice: 'asc' } }),
      );
      expect(JSON.stringify(result.data)).not.toContain('costPrice');
    });

    it('returns minPrice=null (no costPrice fallback) when cashPrice unset', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 12', storage: '64GB', category: 'PHONE_USED', _min: { cashPrice: null }, _count: { id: 1 } },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'B' });

      const result = await service.listGroupedByModel({});

      expect(result.data[0].minPrice).toBeNull();
      expect(result.data[0].monthlyPaymentFrom).toBe(0);
    });

    it('filters by search text on brand OR model (case-insensitive)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: ' iphone 15 ' });
      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { brand: { contains: 'iphone 15', mode: 'insensitive' } },
              { model: { contains: 'iphone 15', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('ignores a blank search string', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: '   ' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });
  });
```

- [ ] **Step 2: รัน test ให้เห็นว่า fail**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t listGroupedByModel`
Expected: FAIL (by ยังเป็น 3 keys, ยังใช้ costPrice, ไม่มี field condition)

- [ ] **Step 3: แก้ service — filters type + constants + where + group + payload**

ใน `shop-catalog.service.ts` เพิ่ม constants ใต้ `DEFAULT_DOWN_PCT` (บรรทัด ~48):

```ts
const SHOP_BRAND = 'Apple';
const PHONE_CATEGORIES = ['PHONE_NEW', 'PHONE_USED'] as const;
```

เพิ่ม `condition` ใน `ProductGroup` interface + เปลี่ยน `minPrice` เป็น nullable:

```ts
export interface ProductGroup {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  minPrice: number | null;
  stockCount: number;
  thumbnailUrl?: string;
  conditionGrades: string[];
  monthlyPaymentFrom: number;
  condition: 'NEW' | 'USED';
}
```

แก้ signature ของ `listGroupedByModel` ให้รับ `condition`:

```ts
  async listGroupedByModel(filters: {
    page?: number;
    limit?: number;
    brand?: string;
    condition?: 'NEW' | 'USED';
    conditionGrade?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    search?: string;
  }): Promise<{ data: ProductGroup[]; total: number; page: number; limit: number }> {
```

แทนที่ block สร้าง `where` (เดิมบรรทัด 67-82) ด้วย:

```ts
    const where: any = {
      deletedAt: null,
      isOnlineVisible: true,
      status: 'IN_STOCK',
      brand: SHOP_BRAND,
      category: filters.condition
        ? filters.condition === 'NEW' ? 'PHONE_NEW' : 'PHONE_USED'
        : { in: [...PHONE_CATEGORIES] },
    };
    if (filters.conditionGrade) where.conditionGrade = filters.conditionGrade;
    if (filters.minPrice !== undefined) where.cashPrice = { ...where.cashPrice, gte: filters.minPrice };
    if (filters.maxPrice !== undefined) where.cashPrice = { ...where.cashPrice, lte: filters.maxPrice };
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
      ];
    }
```

แทนที่ `orderBy` (เดิมบรรทัด 84-88) — เปลี่ยน costPrice → cashPrice:

```ts
    const orderBy =
      filters.sort === 'price_asc' ? [{ _min: { cashPrice: 'asc' as const } }] :
      filters.sort === 'price_desc' ? [{ _min: { cashPrice: 'desc' as const } }] :
      filters.sort === 'newest' ? [{ _max: { createdAt: 'desc' as const } }] :
      [{ _count: { id: 'desc' as const } }];
```

แทนที่ groupBy (เดิมบรรทัด 92-100) — เพิ่ม `category` ใน `by` + `_min: cashPrice`:

```ts
    const groups = await this.prisma.product.groupBy({
      by: ['brand', 'model', 'storage', 'category'],
      where,
      _min: { cashPrice: true },
      _count: { id: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    });
```

แทนที่ block สร้าง `data` (เดิมบรรทัด 103-123) — sample orderBy cashPrice, minPrice nullable, +condition:

```ts
    const data: ProductGroup[] = await Promise.all(groups.map(async (g) => {
      const sample = await this.prisma.product.findFirst({
        where: { ...where, brand: g.brand, model: g.model, storage: g.storage, category: g.category },
        orderBy: { cashPrice: 'asc' },
        select: { id: true, gallery: true, conditionGrade: true },
      });
      const minPrice = g._min?.cashPrice != null ? Number(g._min.cashPrice) : null;
      const stockCount = g._count?.id ?? 0;
      const monthly = minPrice != null ? this.calculateMonthlyPayment(minPrice, DEFAULT_MONTHS, DEFAULT_DOWN_PCT) : 0;
      return {
        id: sample?.id ?? '',
        brand: g.brand,
        model: g.model,
        storage: g.storage ?? undefined,
        minPrice,
        stockCount,
        thumbnailUrl: sample?.gallery[0],
        conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
        monthlyPaymentFrom: monthly,
        condition: g.category === 'PHONE_NEW' ? 'NEW' : 'USED',
      };
    }));
```

แทนที่ `allGroups` (เดิมบรรทัด 126-129) — เพิ่ม `category` ใน `by`:

```ts
    const allGroups = await this.prisma.product.groupBy({
      by: ['brand', 'model', 'storage', 'category'],
      where,
    });
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t listGroupedByModel`
Expected: PASS ทุก it

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shop-catalog/shop-catalog.service.ts apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts
git commit -m "feat(shop-catalog): iPhone-only + group by category (มือ1/มือ2) + cashPrice pricing basis"
```

---

### Task 3: Service `getProductDetail` — กรอง category + ฐานราคา cashPrice + field condition

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- Test: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts`

**Interfaces:**
- Produces: `ProductDetail.condition: 'NEW' | 'USED'`; tiers/units ใช้ `cashPrice` (ไม่มี costPrice)

- [ ] **Step 1: แก้ test detail ให้ล้มก่อน**

แทนที่ `describe('getProductDetail', ...)` block เดิม (บรรทัด 93-112) ด้วย — mock ใช้ `cashPrice`:

```ts
  describe('getProductDetail', () => {
    it('scopes units to the SAME category as the clicked card (no new/used mix)', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED',
        cashPrice: 13900, conditionGrade: 'A', gallery: [], gallery360: [], isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'u1', conditionGrade: 'A', batteryHealth: 92, cashPrice: 13900, gallery: [], gallery360: [], imeiSerial: null },
        { id: 'u2', conditionGrade: 'B', batteryHealth: 87, cashPrice: 12800, gallery: [], gallery360: [], imeiSerial: null },
      ]);

      const result = await service.getProductDetail('p1');

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'PHONE_USED' }) }),
      );
      expect(result!.condition).toBe('USED');
      expect(result!.tiers.A.units).toHaveLength(1);
      expect(result!.tiers.A.minPrice).toBe(13900);
      expect(JSON.stringify(result)).not.toContain('costPrice');
    });

    it('reports condition=NEW for a brand-new phone', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p2', brand: 'Apple', model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW',
        cashPrice: 29900, conditionGrade: null, gallery: [], gallery360: [], isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'n1', conditionGrade: null, cashPrice: 29900, gallery: [], gallery360: [], imeiSerial: null },
      ]);

      const result = await service.getProductDetail('p2');
      expect(result!.condition).toBe('NEW');
    });
  });
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t getProductDetail`
Expected: FAIL (findMany where ไม่มี category, ยังใช้ costPrice, ไม่มี field condition)

- [ ] **Step 3: แก้ service `getProductDetail`**

เพิ่ม `condition` ใน `ProductDetail` interface (หลัง `category: string;`):

```ts
  category: string;
  condition: 'NEW' | 'USED';
```

เปลี่ยน `ProductUnit.costPrice` เป็น `cashPrice`:

```ts
export interface ProductUnit {
  id: string;
  conditionGrade: string;
  batteryHealth?: number;
  hasBox?: boolean;
  hasCharger?: boolean;
  hasHeadphones?: boolean;
  shopWarrantyDays?: number;
  cashPrice: number;
  imeiPartial?: string;
  gallery: string[];
  gallery360: string[];
}
```

แทน `allUnits` query (เดิมบรรทัด 140-150) — เพิ่ม `category: product.category`:

```ts
    const allUnits = await this.prisma.product.findMany({
      where: {
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        category: product.category,
        deletedAt: null,
        isOnlineVisible: true,
        status: 'IN_STOCK',
      },
      orderBy: { cashPrice: 'asc' },
    });
```

แทน loop สร้าง tiers (เดิมบรรทัด 152-171) — ใช้ `cashPrice` (null → 0 = จะโชว์ "สอบถามราคา" ฝั่ง UI):

```ts
    const tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }> = {};
    for (const u of allUnits) {
      const grade = u.conditionGrade ?? 'unknown';
      if (!tiers[grade]) tiers[grade] = { minPrice: Infinity, maxPrice: 0, units: [] };
      const price = u.cashPrice != null ? Number(u.cashPrice) : 0;
      const imeiPartial = u.imeiSerial ? `••••••••••${u.imeiSerial.slice(-4)}` : undefined;
      tiers[grade].units.push({
        id: u.id,
        conditionGrade: grade,
        batteryHealth: u.batteryHealth ?? undefined,
        hasBox: u.hasBox ?? undefined,
        shopWarrantyDays: u.shopWarrantyDays ?? undefined,
        cashPrice: price,
        imeiPartial,
        gallery: u.gallery,
        gallery360: u.gallery360,
      });
      if (price < tiers[grade].minPrice) tiers[grade].minPrice = price;
      if (price > tiers[grade].maxPrice) tiers[grade].maxPrice = price;
    }
```

เพิ่ม `condition` ใน return object (หลัง `category: product.category,`):

```ts
      category: product.category,
      condition: product.category === 'PHONE_NEW' ? 'NEW' : 'USED',
```

- [ ] **Step 4: รัน test ให้ผ่าน (ทั้งไฟล์)**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shop-catalog/shop-catalog.service.ts apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts
git commit -m "fix(shop-catalog): detail scopes units by category + cashPrice basis + condition field"
```

---

### Task 4: web-shop ProductCard — field `condition` + ป้าย + minPrice nullable

**Files:**
- Modify: `apps/web-shop/src/components/catalog/ProductCard.tsx`

**Interfaces:**
- Consumes: `ProductGroup.condition: 'NEW' | 'USED'`, `minPrice: number | null` (จาก API)

- [ ] **Step 1: แก้ interface `ProductGroup`**

ใน `ProductCard.tsx` แก้ interface (บรรทัด 4-16):

```ts
export interface ProductGroup {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  minPrice: number | null;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  conditionGrades?: string[];
  condition: 'NEW' | 'USED';
  stock: { display: string; tone: string };
}
```

- [ ] **Step 2: เพิ่มป้ายสภาพเครื่อง + จัดการ minPrice null**

ใน component `ProductCard` เพิ่มก่อน `return (` (หลังบรรทัด `const grades = p.conditionGrades ?? [];`):

```ts
  const condBadge =
    p.condition === 'NEW'
      ? { label: 'มือ 1 · ของใหม่', cls: 'bg-emerald-600 text-white' }
      : { label: 'มือ 2 · มือสอง', cls: 'bg-zinc-900/80 text-white' };
```

เพิ่มป้ายมุมขวาบนของ image plate — วางถัดจาก block เกรด (หลัง `</div>` ปิด grades block, ก่อน `</div>` ปิด image plate div บรรทัด 61):

```tsx
          <span
            className={cn(
              'absolute top-2 right-2 md:top-3 md:right-3 text-[10px] md:text-[11px] font-medium px-2 py-0.5 rounded-full leading-none',
              condBadge.cls,
            )}
          >
            {condBadge.label}
          </span>
```

แทน block ราคา (บรรทัด 75-89) เพื่อรองรับ `minPrice == null`:

```tsx
          {p.minPrice == null ? (
            <p className="text-base md:text-lg font-medium text-muted-foreground pt-1 md:pt-2">
              สอบถามราคา
            </p>
          ) : p.monthlyPaymentFrom > 0 ? (
            <>
              <p className="num text-lg md:text-2xl font-semibold text-emerald-600 pt-1 md:pt-2">
                ผ่อน ฿{p.monthlyPaymentFrom.toLocaleString()}
                <span className="text-[11px] md:text-sm font-normal">/เดือน</span>
              </p>
              <p className="text-[11px] md:text-[13px] text-muted-foreground">
                ราคาเต็ม <span className="num">฿{p.minPrice.toLocaleString()}</span>
              </p>
            </>
          ) : (
            <p className="num text-lg md:text-2xl font-semibold text-foreground pt-1 md:pt-2">
              ฿{p.minPrice.toLocaleString()}
            </p>
          )}
```

- [ ] **Step 3: tsc + build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ ไม่มี error

- [ ] **Step 4: Commit**

```bash
git add apps/web-shop/src/components/catalog/ProductCard.tsx
git commit -m "feat(web-shop): มือ1/มือ2 badge on ProductCard + สอบถามราคา when price unset"
```

---

### Task 5: web-shop CatalogPage — ลบตัวกรองแบรนด์ + เพิ่มตัวกรองสภาพเครื่อง + heroNoun/meta

**Files:**
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx`
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (เฉพาะ `CatalogFilters` type)

**Interfaces:**
- Consumes: API param `condition=NEW|USED`
- Produces: `CatalogFilters.condition?: 'NEW' | 'USED'`

- [ ] **Step 1: เพิ่ม `condition` ใน CatalogFilters type**

ใน `FilterSidebar.tsx` แก้ interface (บรรทัด 1-7):

```ts
export interface CatalogFilters {
  brand?: string;
  condition?: 'NEW' | 'USED';
  conditionGrade?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
}
```

- [ ] **Step 2: CatalogPage — เปลี่ยน constant + meta**

แทน `BRANDS` (บรรทัด 31) ด้วย constant สภาพเครื่อง:

```ts
const CONDITIONS: Array<{ v: '' | 'NEW' | 'USED'; label: string }> = [
  { v: '', label: 'ทั้งหมด' },
  { v: 'NEW', label: 'มือ 1 · ของใหม่' },
  { v: 'USED', label: 'มือ 2 · มือสอง' },
];
```

แก้ meta (บรรทัด 72-75):

```ts
  usePageMeta(
    'สินค้าทั้งหมด',
    'iPhone มือ 1 และมือสอง ตรวจ 30 จุด ผ่อนบัตรประชาชนใบเดียว ร้านมือถือลพบุรี',
  );
```

- [ ] **Step 3: CatalogPage — เอา brand ออกจาก state/URL/query, เพิ่ม condition**

แก้ initial state (บรรทัด 78-81):

```ts
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    condition: (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined,
    search: searchParams.get('search') ?? undefined,
  }));
```

แก้ effect ที่ sync URL (บรรทัด 93-97):

```ts
  useEffect(() => {
    const condition = (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    setFilters((f) =>
      f.condition === condition && f.search === search ? f : { ...f, condition, search },
    );
  }, [searchParams]);
```

แก้ `updateFilters` (บรรทัด 101-109):

```ts
  function updateFilters(next: CatalogFilters) {
    setFilters(next);
    const sp = new URLSearchParams(searchParams);
    if (next.condition) sp.set('condition', next.condition);
    else sp.delete('condition');
    if (next.search) sp.set('search', next.search);
    else sp.delete('search');
    setSearchParams(sp, { replace: true });
  }
```

แก้ queryFn params (บรรทัด 132-140) — brand→condition:

```ts
        const params = new URLSearchParams();
        if (filters.condition) params.set('condition', filters.condition);
        if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
        if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
        if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
        if (filters.search) params.set('search', filters.search);
        params.set('sort', sort);
        params.set('page', String(pageParam));
        return api.get(`/api/shop/products?${params}`).then((r) => r.data);
```

- [ ] **Step 4: CatalogPage — heroNoun คงที่ + derived vars**

แทน `activeBrand` + `heroNoun` (บรรทัด 149, 155-159) ด้วย:

```ts
  const activeCondition = filters.condition ?? '';
  const activeGrade = filters.conditionGrade ?? '';
  const activeSortLabel = SORTS.find((s) => s.v === sort)?.label ?? '';
  const heroNoun = 'iPhone';
```

(ลบบรรทัด `const activeGrade = ...` เดิมบรรทัด 150 ที่ซ้ำออก ให้เหลือชุดเดียวด้านบน)

- [ ] **Step 5: CatalogPage — แทนแถวปุ่มแบรนด์ด้วยแถวสภาพเครื่อง + ซ่อนเกรดเมื่อเลือกมือ 1**

แทน block ปุ่มแบรนด์ (บรรทัด 207-222) ด้วยปุ่มสภาพเครื่อง:

```tsx
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <Pill
                  key={c.v || 'all'}
                  active={activeCondition === c.v}
                  onClick={() =>
                    updateFilters({
                      ...filters,
                      condition: c.v || undefined,
                      // มือ 1 ไม่มีเกรดตำหนิ — ล้างตัวกรองเกรดทิ้ง
                      conditionGrade: c.v === 'NEW' ? undefined : filters.conditionGrade,
                    })
                  }
                >
                  {c.label}
                </Pill>
              ))}
            </div>
```

ครอบ block เกรด (บรรทัด 226-238) ด้วยเงื่อนไขซ่อนเมื่อเลือกมือ 1:

```tsx
            {activeCondition !== 'NEW' && (
              <div className="flex flex-wrap gap-2">
                {GRADES.map((g) => (
                  <Pill
                    key={g.v || 'all'}
                    active={activeGrade === g.v}
                    onClick={() =>
                      updateFilters({ ...filters, conditionGrade: g.v || undefined })
                    }
                  >
                    {g.label}
                  </Pill>
                ))}
              </div>
            )}
```

- [ ] **Step 6: tsc + build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ (ไม่มี reference ถึง `BRANDS`/`activeBrand` ที่เหลือค้าง)

- [ ] **Step 7: Commit**

```bash
git add apps/web-shop/src/pages/CatalogPage.tsx apps/web-shop/src/components/catalog/FilterSidebar.tsx
git commit -m "feat(web-shop): replace brand filter with มือ1/มือ2 condition filter + URL sync"
```

---

### Task 6: web-shop FilterSidebar — ลบ dropdown แบรนด์

**Files:**
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.tsx`

- [ ] **Step 1: ลบ block แบรนด์**

ลบ `<div>` block แบรนด์ (บรรทัด 18-28 — `<h4>แบรนด์</h4>` + `<select>`) ออก ให้ `<aside>` เริ่มด้วย block "สภาพเครื่อง" (เกรด) เป็นอันแรก. ผลลัพธ์คือ `FilterSidebar` เหลือ: เกรด A/B/C + ช่วงราคา (ตัวกรองสภาพมือ1/มือ2 อยู่บน toolbar หลักแล้ว)

- [ ] **Step 2: tsc + build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ

- [ ] **Step 3: Commit**

```bash
git add apps/web-shop/src/components/catalog/FilterSidebar.tsx
git commit -m "feat(web-shop): remove brand dropdown from FilterSidebar (iPhone-only)"
```

---

### Task 7: web-shop ProductDetailPage — ป้ายสภาพเครื่อง + ซ่อนเกรดสำหรับมือ 1 + สอบถามราคา

**Files:**
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx`

**Interfaces:**
- Consumes: `ProductDetail.condition: 'NEW' | 'USED'`

- [ ] **Step 1: เพิ่ม `condition` ใน interface + เปลี่ยน ProductUnit.costPrice→cashPrice**

แก้ `ProductUnit` (บรรทัด 28-40): เปลี่ยน `costPrice: number;` เป็น `cashPrice: number;`
แก้ `ProductDetail` (บรรทัด 42-55): เพิ่มหลัง `category: string;`:

```ts
  category: string;
  condition: 'NEW' | 'USED';
```

- [ ] **Step 2: derived isNew + ป้ายสภาพเครื่อง + gate เกรด**

หลัง `const gradeKeys = Object.keys(data.tiers);` (บรรทัด 162) เพิ่ม:

```ts
  const isNew = data.condition === 'NEW';
  const showGrades = !isNew && gradeKeys.length > 0;
```

แทน block เกรด badges (บรรทัด 210-218) ด้วยป้ายสภาพเครื่อง (แสดงเสมอ) + เกรด (เฉพาะมือสอง):

```tsx
            <div className="flex flex-wrap gap-2">
              <Badge variant={isNew ? 'condition-a' : 'condition-b'} size="md">
                {isNew ? 'เครื่องใหม่ · มือ 1' : 'มือสอง · มือ 2'}
              </Badge>
              {showGrades &&
                gradeKeys.map((g) => (
                  <Badge key={g} variant={conditionVariant(g)} size="md">
                    เกรด {g}
                  </Badge>
                ))}
            </div>
```

แทน block ราคา (บรรทัด 220-233) เพื่อรองรับราคา 0 = สอบถามราคา:

```tsx
            <div className="space-y-1">
              {price > 0 ? (
                <div className="text-3xl md:text-4xl font-bold text-emerald-600 leading-snug">
                  ฿{price.toLocaleString()}
                </div>
              ) : (
                <div className="text-2xl md:text-3xl font-semibold text-muted-foreground leading-snug">
                  สอบถามราคาทางไลน์
                </div>
              )}
              {monthlyFrom && (
                <div className="text-base font-semibold text-emerald-700 leading-snug">
                  ผ่อนเริ่ม ฿{monthlyFrom.toLocaleString()}/เดือน
                  <span className="text-xs font-normal text-muted-foreground">
                    {' '}
                    (12 งวด ดาวน์ 15%)
                  </span>
                </div>
              )}
            </div>
```

แทน block คำอธิบายเกรด (บรรทัด 235-241) ให้ใช้ `showGrades`:

```tsx
            {showGrades && (
              <ul className="space-y-1 text-sm text-muted-foreground leading-snug">
                {gradeKeys.map((g) => (
                  <li key={g}>{conditionDescription(g)}</li>
                ))}
              </ul>
            )}
```

- [ ] **Step 3: tsc + build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ (ตรวจว่าไม่มีที่อื่นอ้าง `unit.costPrice`)

- [ ] **Step 4: Commit**

```bash
git add apps/web-shop/src/pages/ProductDetailPage.tsx
git commit -m "feat(web-shop): condition badge on detail, hide grade for มือ1, สอบถามราคา fallback"
```

---

### Task 8: คำโฆษณา / SEO — "iPhone มือสอง" → "iPhone มือ 1 & มือ 2"

**Files:**
- Modify: `apps/web-shop/src/lib/copy.ts`
- Modify: `apps/web-shop/src/components/hero/HomeHero.tsx`
- Modify: `apps/web-shop/src/pages/HomePage.tsx`
- Modify: `apps/web-shop/src/pages/AboutPage.tsx`
- Modify: `apps/web-shop/src/pages/ContactPage.tsx`
- Modify: `apps/web-shop/src/pages/HowItWorksPage.tsx`
- Modify: `apps/web-shop/src/pages/PromotionsPage.tsx`

- [ ] **Step 1: copy.ts**

- บรรทัด 46: `heroTitle: 'iPhone มือสองคุณภาพ\nผ่อนได้บัตร ปชช. ใบเดียว',`
  → `heroTitle: 'iPhone มือ 1 & มือ 2 คุณภาพ\nผ่อนได้บัตร ปชช. ใบเดียว',`
- บรรทัด 54: `serviceBuyTitle: 'ซื้อ/ผ่อนมือถือ',`
  → `serviceBuyTitle: 'ซื้อ/ผ่อน iPhone',`
- บรรทัด 287: `milestone1Description: 'เปิดสาขาแรกที่ลพบุรี เน้นขาย iPhone มือสองคุณภาพ',`
  → `milestone1Description: 'เปิดสาขาแรกที่ลพบุรี เน้นขาย iPhone ทั้งมือ 1 และมือสองคุณภาพ',`

- [ ] **Step 2: HomeHero.tsx (บรรทัด 24)**

`iPhone มือสองคุณภาพ` → `iPhone มือ 1 & มือ 2 คุณภาพ`

- [ ] **Step 3: meta descriptions**

- `HomePage.tsx:86`: `'iPhone มือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว ตรวจ 30 จุด รับประกันร้าน 30 วัน ร้านมือถือลพบุรี'`
  → `'iPhone มือ 1 และมือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว ตรวจ 30 จุด รับประกันร้าน 30 วัน ร้านมือถือลพบุรี'`
- `HomePage.tsx:142`: `description="ซื้อมือถือมือสองอย่างสบายใจ ผ่อนง่าย รับประกันจริง"`
  → `description="ซื้อ iPhone มือ 1 และมือสองอย่างสบายใจ ผ่อนง่าย รับประกันจริง"`
- `AboutPage.tsx:72`: `'...ขาย iPhone มือสองของแท้ ผ่อน...'`
  → `'...ขาย iPhone มือ 1 และมือสองของแท้ ผ่อน...'`
- `ContactPage.tsx:24`: `'...ซื้อ-ผ่อน iPhone มือสอง'`
  → `'...ซื้อ-ผ่อน iPhone มือ 1 และมือสอง'`
- `HowItWorksPage.tsx:88`: `'วิธีผ่อน iPhone มือสองบัตรประชาชน...'`
  → `'วิธีผ่อน iPhone มือ 1 และมือสองบัตรประชาชน...'`
- `PromotionsPage.tsx:47`: `'โปรโมชันและส่วนลด iPhone มือสองผ่อน...'`
  → `'โปรโมชันและส่วนลด iPhone มือ 1 และมือสองผ่อน...'`

**หมายเหตุ:** อย่าแตะ `PromotionsPage.tsx:25` (`PHONE_USED: 'มือถือมือสอง'`) — เป็น label ฟังก์ชันของ CATEGORY_LABELS ไม่ใช่ marketing copy

- [ ] **Step 4: tsc + build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ

- [ ] **Step 5: Commit**

```bash
git add apps/web-shop/src/lib/copy.ts apps/web-shop/src/components/hero/HomeHero.tsx apps/web-shop/src/pages/HomePage.tsx apps/web-shop/src/pages/AboutPage.tsx apps/web-shop/src/pages/ContactPage.tsx apps/web-shop/src/pages/HowItWorksPage.tsx apps/web-shop/src/pages/PromotionsPage.tsx
git commit -m "feat(web-shop): reword copy/SEO from iPhone มือสอง → iPhone มือ 1 & มือ 2"
```

---

### Task 9: Verify รวม — full api test suite + build ทั้งสองแอป

**Files:** ไม่มีการแก้โค้ด (verification เท่านั้น)

- [ ] **Step 1: api shop-catalog specs เขียว**

Run: `cd apps/api && npx jest src/modules/shop-catalog`
Expected: PASS ทั้ง `shop-catalog.service.spec.ts` + `installment-preview.service.spec.ts` (ตัวหลังไม่ควรกระทบ)

- [ ] **Step 2: api tsc เขียว**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: ไม่มี error ใหม่ (ตรวจว่าไม่มี caller อื่นอ้าง `ProductUnit.costPrice` / `ProductGroup.minPrice` แบบ non-null)

- [ ] **Step 3: web-shop build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ

- [ ] **Step 4: Manual smoke (ถ้ารัน local ได้)**

- `/products` → เห็นแถว "สภาพเครื่อง: ทั้งหมด/มือ 1/มือ 2", ไม่มีปุ่มแบรนด์, การ์ดมีป้ายมือ 1/มือ 2
- กด "มือ 1" → เกรด A/B/C หาย, list เหลือเครื่องใหม่
- กดการ์ด → หน้า detail สภาพตรงกับการ์ด (ไม่ปนใหม่/มือสอง), เครื่องใหม่ไม่มี "เกรด unknown"
- ยืนยันไม่มี `costPrice` ใน Network response ของ `/api/shop/products` และ `/api/shop/products/:id`

---

## Self-Review

**1. Spec coverage:**
- A iPhone-only → Task 2 (where brand+category) + Task 5/6 (ลบ UI แบรนด์) ✅
- B มือ1/มือ2 facet → Task 1 (DTO) + Task 2 (group+condition) + Task 3 (detail seam) + Task 4 (badge) + Task 5 (filter) + Task 7 (detail badge/hide grade) ✅
- C price fix costPrice→cashPrice → Task 2 (list) + Task 3 (detail) + Task 4/7 (null→สอบถามราคา) ✅
- D copy/SEO → Task 8 ✅
- Seam fixes (detail category filter, new-phone unknown grade) → Task 3 + Task 7 ✅

**2. Placeholder scan:** ไม่มี TBD/TODO; ทุก step มีโค้ด/คำสั่งจริง ✅

**3. Type consistency:** `condition: 'NEW' | 'USED'` ใช้เหมือนกันทุก layer (DTO/service ProductGroup/ProductDetail/ProductCard/ProductDetailPage/CatalogFilters); `minPrice: number | null` sync ระหว่าง service ProductGroup ↔ ProductCard; `ProductUnit.cashPrice` sync service ↔ ProductDetailPage ✅

## Post-implementation (นอกแผน — owner/ops)
- เจ้าของกรอก `cashPrice`/`installmentPrice` ให้สินค้า (ไม่งั้นโชว์ "สอบถามราคา")
- ลงสต็อกเครื่อง `PHONE_NEW` online-visible เพื่อให้แท็บ "มือ 1" มีของ
- Open verify ตอนทำ: ค่า `brand` ใน DB = `'Apple'` เป๊ะ (ถ้าไม่ใช่ → normalize/case-insensitive ใน Task 2 where)
