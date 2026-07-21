# Web-shop Model Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่ม dropdown กรองตามรุ่น iPhone ในหน้า `/products` โดยแสดงเฉพาะรุ่นที่มีของจริง

**Architecture:** Backend เพิ่ม `model` exact filter ใน list + endpoint `GET /api/shop/models` (distinct รุ่น เรียง count desc) โดย extract `shopBaseWhere()` ให้ทั้งสอง path ใช้ predicate iPhone-only ร่วมกัน (กัน drift). Frontend เพิ่ม native `<select>` + query รุ่น + sync `?model=` ครบทั้ง initial/effect/updateFilters/queryFn. ไม่มี schema/migration.

**Tech Stack:** NestJS + Prisma (jest mock-prisma) · React + Vite + React Query (tsc+build)

## Global Constraints

- ห้ามแก้ schema / ไม่มี migration
- iPhone-only base = `brand: 'Apple'` + `category: { in: ['PHONE_NEW','PHONE_USED'] }` + `IN_STOCK` + `isOnlineVisible` + `deletedAt: null` — **ต้องมาจาก `shopBaseWhere()` ตัวเดียว** ทั้ง list + models
- refactor `shopBaseWhere` = **behavior-preserving** (test iPhone-only เดิมต้องยังผ่าน)
- sort รุ่น = **count desc** ด้วย `orderBy: [{ _count: { id: 'desc' as const } }]` (array form ตาม service เดิม)
- frontend = **native `<select>`** (ไม่ copy custom listbox); URL param key = `model`
- URL sync ต้องแตะ **4 จุด**: initial state, effect, updateFilters, queryFn
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2; รัน `npx prettier --write` ก่อน commit
- api tests: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts`
- web-shop verify: `cd apps/web-shop && npx tsc --noEmit && npm run build`

---

### Task 1: Backend — extract `shopBaseWhere()` + model filter ใน list + DTO

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- Test: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts`

**Interfaces:**
- Produces: module fn `shopBaseWhere(): Record<string, any>`; `listGroupedByModel` filters รับ `model?: string`; `ListProductsDto.model?: string`

- [ ] **Step 1: เขียน test ให้ล้มก่อน (model filter)**

เพิ่ม `it` ใน `describe('listGroupedByModel')`:

```ts
    it('filters by exact model while keeping the iPhone-only base', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ model: 'iPhone 16' });
      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            model: 'iPhone 16',
            brand: 'Apple',
            category: { in: ['PHONE_NEW', 'PHONE_USED'] },
            isOnlineVisible: true,
            status: 'IN_STOCK',
          }),
        }),
      );
    });
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t "filters by exact model"`
Expected: FAIL (where ไม่มี `model`)

- [ ] **Step 3: DTO — เพิ่ม `model`**

ใน `list-products.dto.ts` เพิ่มหลัง `brand?: string;`:

```ts
  @IsOptional() @IsString() @MaxLength(60)
  model?: string;
```

- [ ] **Step 4: Service — extract `shopBaseWhere()` + ใช้ใน list + เพิ่ม model filter**

ใน `shop-catalog.service.ts` เพิ่มฟังก์ชันใต้บรรทัด `const GROUP_BY = [...] as const;` (module scope, นอก class):

```ts
function shopBaseWhere(): Record<string, any> {
  return {
    deletedAt: null,
    isOnlineVisible: true,
    status: 'IN_STOCK',
    brand: SHOP_BRAND,
    category: { in: [...PHONE_CATEGORIES] },
  };
}
```

เพิ่ม `model?: string;` ใน filters param ของ `listGroupedByModel` (หลัง `condition?: 'NEW' | 'USED';`):

```ts
    condition?: 'NEW' | 'USED';
    model?: string;
```

แทน block สร้าง `where` เดิม (ตั้งแต่ `const where: any = {` ถึงก่อน `if (filters.conditionGrade)`) ด้วย:

```ts
    const where: any = { ...shopBaseWhere() };
    if (filters.condition) {
      where.category = filters.condition === 'NEW' ? 'PHONE_NEW' : 'PHONE_USED';
    }
    if (filters.model) where.model = filters.model;
    if (filters.conditionGrade) where.conditionGrade = filters.conditionGrade;
```

(บรรทัด `minPrice`/`maxPrice`/`search` ที่ตามมา คงเดิมไม่แตะ)

- [ ] **Step 5: รัน test ให้ผ่าน (ทั้ง describe list — behavior-preserving)**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t listGroupedByModel`
Expected: PASS ทุก it (รวมของเดิมที่ยืนยัน iPhone-only where + ตัวใหม่)

- [ ] **Step 6: prettier + commit**

```bash
cd apps/api && npx prettier --write src/modules/shop-catalog/dto/list-products.dto.ts src/modules/shop-catalog/shop-catalog.service.ts src/modules/shop-catalog/shop-catalog.service.spec.ts
cd "$(git rev-parse --show-toplevel)"
git add apps/api/src/modules/shop-catalog/dto/list-products.dto.ts apps/api/src/modules/shop-catalog/shop-catalog.service.ts apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts
git commit -m "feat(shop-catalog): extract shopBaseWhere() + model exact filter in list"
```

---

### Task 2: Backend — `listAvailableModels()` + endpoint `GET /api/shop/models`

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`
- Test: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts`

**Interfaces:**
- Consumes: `shopBaseWhere()` (Task 1)
- Produces: `listAvailableModels(): Promise<{ model: string; count: number }[]>`; route `GET shop/models`

- [ ] **Step 1: เขียน test ให้ล้มก่อน**

เพิ่ม `describe` ใหม่ในไฟล์ spec (ต้อง mock `prisma.product.groupBy`):

```ts
  describe('listAvailableModels', () => {
    it('returns distinct models with counts, iPhone-only base, sorted by count desc', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { model: 'iPhone 16', _count: { id: 5 } },
        { model: 'iPhone 15', _count: { id: 2 } },
      ]);

      const result = await service.listAvailableModels();

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['model'],
          where: expect.objectContaining({
            brand: 'Apple',
            category: { in: ['PHONE_NEW', 'PHONE_USED'] },
            isOnlineVisible: true,
            status: 'IN_STOCK',
            deletedAt: null,
          }),
          orderBy: [{ _count: { id: 'desc' } }],
        }),
      );
      expect(result).toEqual([
        { model: 'iPhone 16', count: 5 },
        { model: 'iPhone 15', count: 2 },
      ]);
    });
  });
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t listAvailableModels`
Expected: FAIL (method not defined)

- [ ] **Step 3: Service — เพิ่ม `listAvailableModels()`**

ใน class `ShopCatalogService` เพิ่ม method (วางหลัง `listGroupedByModel`):

```ts
  async listAvailableModels(): Promise<{ model: string; count: number }[]> {
    const rows = await this.prisma.product.groupBy({
      by: ['model'],
      where: shopBaseWhere(),
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' as const } }],
    });
    return rows.map((r) => ({ model: r.model, count: r._count?.id ?? 0 }));
  }
```

- [ ] **Step 4: Controller — เพิ่ม route**

ใน `shop-catalog.controller.ts` เพิ่ม method หลัง `list()` (ก่อน `detail()`):

```ts
  @Get('models')
  async models() {
    return this.catalogService.listAvailableModels();
  }
```

(อยู่ใต้ `@Controller('shop')` + `@UseGuards(ShopBotDefenseGuard)` เดิม — path `shop/models` ไม่ชนกับ `shop/products/:id`)

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 6: prettier + commit**

```bash
cd apps/api && npx prettier --write src/modules/shop-catalog/shop-catalog.service.ts src/modules/shop-catalog/shop-catalog.controller.ts src/modules/shop-catalog/shop-catalog.service.spec.ts
cd "$(git rev-parse --show-toplevel)"
git add apps/api/src/modules/shop-catalog/shop-catalog.service.ts apps/api/src/modules/shop-catalog/shop-catalog.controller.ts apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts
git commit -m "feat(shop-catalog): GET /api/shop/models — distinct models with counts"
```

---

### Task 3: Frontend — model `<select>` + query + URL sync (4 จุด)

**Files:**
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (type only)
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx`

**Interfaces:**
- Consumes: `GET /api/shop/models` → `{ model: string; count: number }[]`; list API param `model`
- Produces: `CatalogFilters.model?: string`

- [ ] **Step 1: CatalogFilters — เพิ่ม `model`**

ใน `FilterSidebar.tsx` แก้ interface:

```ts
export interface CatalogFilters {
  brand?: string;
  condition?: 'NEW' | 'USED';
  model?: string;
  conditionGrade?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
}
```

- [ ] **Step 2: CatalogPage — import useQuery + ModelOption type + models query**

แก้ import react-query (เดิม `import { useInfiniteQuery } from '@tanstack/react-query';`):

```ts
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
```

เพิ่ม type ใกล้ `interface CatalogResponse` (บนสุดของไฟล์ ใต้ imports):

```ts
interface ModelOption {
  model: string;
  count: number;
}
```

เพิ่ม models query หลังบรรทัด `const track = useTrackEvent();` (ในตัว component):

```ts
  const { data: models } = useQuery<ModelOption[]>({
    queryKey: ['shop', 'models'],
    queryFn: () => api.get('/api/shop/models').then((r) => r.data),
  });
```

- [ ] **Step 3: CatalogPage — URL sync จุดที่ 1 (initial state)**

แก้ initial `useState` ให้อ่าน `model`:

```ts
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    condition: (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined,
    model: searchParams.get('model') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  }));
```

- [ ] **Step 4: CatalogPage — URL sync จุดที่ 2 (effect)**

แก้ effect re-sync ให้รวม `model` (กัน back/forward ค้าง):

```ts
  useEffect(() => {
    const condition = (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const model = searchParams.get('model') ?? undefined;
    setFilters((f) =>
      f.condition === condition && f.search === search && f.model === model
        ? f
        : { ...f, condition, search, model },
    );
  }, [searchParams]);
```

- [ ] **Step 5: CatalogPage — URL sync จุดที่ 3 (updateFilters)**

เพิ่มการเขียน `model` ใน `updateFilters` (หลังบล็อก condition):

```ts
  function updateFilters(next: CatalogFilters) {
    setFilters(next);
    const sp = new URLSearchParams(searchParams);
    if (next.condition) sp.set('condition', next.condition);
    else sp.delete('condition');
    if (next.model) sp.set('model', next.model);
    else sp.delete('model');
    if (next.search) sp.set('search', next.search);
    else sp.delete('search');
    setSearchParams(sp, { replace: true });
  }
```

- [ ] **Step 6: CatalogPage — URL sync จุดที่ 4 (queryFn param)**

ใน `queryFn` เพิ่ม (หลังบรรทัด condition):

```ts
        if (filters.condition) params.set('condition', filters.condition);
        if (filters.model) params.set('model', filters.model);
```

- [ ] **Step 7: CatalogPage — แทรก `<select>` ในแถบกรอง**

หลัง `</div>` ปิดกลุ่มปุ่ม CONDITIONS (ก่อน `<span className="hidden md:inline-block w-px h-5 bg-border mx-1" />`) แทรก:

```tsx
            <select
              aria-label="กรองตามรุ่น"
              value={filters.model ?? ''}
              onChange={(e) => updateFilters({ ...filters, model: e.target.value || undefined })}
              className="px-3 py-1.5 text-[13px] rounded-full border border-border bg-background text-foreground leading-snug"
            >
              <option value="">ทุกรุ่น</option>
              {models?.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.model}
                </option>
              ))}
            </select>
```

- [ ] **Step 8: tsc + build เขียว**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ

- [ ] **Step 9: prettier + commit**

```bash
cd apps/web-shop && npx prettier --write src/components/catalog/FilterSidebar.tsx src/pages/CatalogPage.tsx
cd "$(git rev-parse --show-toplevel)"
git add apps/web-shop/src/components/catalog/FilterSidebar.tsx apps/web-shop/src/pages/CatalogPage.tsx
git commit -m "feat(web-shop): model filter dropdown + models query + URL sync (?model=)"
```

---

### Task 4: Verify รวม

**Files:** ไม่มีการแก้โค้ด

- [ ] **Step 1: api shop-catalog specs + tsc**

Run: `cd apps/api && npx jest src/modules/shop-catalog && npx tsc --noEmit -p tsconfig.json`
Expected: PASS ทั้งหมด + tsc 0

- [ ] **Step 2: web-shop tsc + build**

Run: `cd apps/web-shop && npx tsc --noEmit && npm run build`
Expected: สำเร็จ

- [ ] **Step 3: Manual smoke (ถ้ารัน local ได้)**

- `/products` → มี dropdown "ทุกรุ่น ▾" ในแถบกรอง; เปิดเห็นรายชื่อรุ่นที่มีของ
- เลือกรุ่น → list กรองเหลือรุ่นนั้น; URL มี `?model=...`
- refresh/deep-link `?model=iPhone 16` → dropdown เลือกไว้ + list กรอง; กด Back → กลับทุกรุ่น
- รวมกับสภาพเครื่อง/เกรด/ค้นหา ทำงานพร้อมกัน

## Self-Review

**1. Spec coverage:**
- A extract shopBaseWhere + model filter → Task 1 ✅
- A2/A3 listAvailableModels + B endpoint → Task 2 ✅
- C frontend select + query + URL sync (4 จุด) → Task 3 (steps 2-7) ✅
- Testing (model filter, listAvailableModels, behavior-preserving) → Task 1/2 tests + Task 4 ✅

**2. Placeholder scan:** ไม่มี TBD/TODO; ทุก step มีโค้ด/คำสั่งจริง ✅

**3. Type consistency:** `{ model: string; count: number }` ตรงกันทั้ง service return / spec / frontend `ModelOption` / select mapping; `CatalogFilters.model?: string` ↔ filters param `model?: string` ↔ DTO `model?: string`; `shopBaseWhere()` return ใช้ทั้ง list + models ✅

## Post-implementation
- ไม่มี owner data-dependency (รุ่นมาจากสต็อกจริง)
- deferred (nit): dependent facet (model×condition), แสดง count บน option, deep-link รุ่นที่ไม่มีของ → select ว่าง
