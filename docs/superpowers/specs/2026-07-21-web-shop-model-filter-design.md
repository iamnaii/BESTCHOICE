# Web-shop: ตัวกรองรุ่น (model filter dropdown) ในหน้า /products

วันที่: 2026-07-21
สถานะ: DESIGN (post-scrutinize, รอ user review)
โมดูลที่เกี่ยว: `apps/web-shop` (CatalogPage) + `apps/api/src/modules/shop-catalog`
ต่อยอดจาก: PR #1368 (iPhone-only + มือ 1/มือ 2 + cashPrice) — main `fde40e802`

## เป้าหมาย (หนึ่งประโยค)

ให้ลูกค้ากรอง catalog หน้า `/products` ตามรุ่น iPhone (เช่น iPhone 16 / 15 / 14) ผ่าน **dropdown ในแถบกรอง** ที่แสดงเฉพาะรุ่นที่มีของจริง

## บริบท / สภาพปัจจุบัน (trace แล้ว)

- แถบกรองปัจจุบันมี: สภาพเครื่อง (pills มือ1/มือ2), เกรด (pills A/B/C), ป๊อป "ตัวกรอง" (เกรด+ราคา), dropdown "เรียง" (custom inline listbox)
- list API `GET /api/shop/products` รองรับ `search` (`model contains`) แต่**ไม่มี model exact filter** และ**ไม่มี endpoint ดึงรายชื่อรุ่น**
- base where ของ `listGroupedByModel` (iPhone-only + in-stock) เขียน **inline** ที่ `shop-catalog.service.ts:73-83` (constants `SHOP_BRAND`/`PHONE_CATEGORIES` มีแล้วที่ :51-52)
- ปุ่ม "เรียง" ใน CatalogPage เป็น **custom listbox inline** (`CatalogPage.tsx:279-307`); component `SortDropdown.tsx` (native `<select>`) มีอยู่แต่**ไม่ถูกใช้** (dead)

## Decisions (จาก /scrutinize)

1. **Frontend UI = native `<select>`** (ไม่ copy custom listbox ~40 บรรทัด) — โค้ดน้อย, a11y ฟรี, mobile-friendly, scale หลายรุ่น
2. **Backend: extract shared base-where** — กัน `/models` endpoint drift จากตัวกรอง list (by construction)
3. **เรียงรุ่นแบบ count desc** (มีของเยอะก่อน) — ไม่ parse เลข (เลี่ยงปัญหา "iPhone SE / mini / Pro Max")
4. **Facet รุ่นเป็นอิสระจากสภาพเครื่อง** (v1) — dropdown โชว์ทุกรุ่นที่มีของ; เลือกรุ่น×สภาพที่ไม่ตัดกัน → list ว่าง (empty state เดิม). dependent facet = ทีหลัง

## ขอบเขต

### In-scope
- Backend: `model` exact filter + endpoint `GET /api/shop/models` + extract `shopBaseWhere()`
- Frontend: native `<select>` "รุ่น" ในแถบกรอง + query รุ่น + URL sync + รวมตัวกรอง

### Non-goals
- Schema/migration (ไม่มี) · dependent facet (model×condition) · แสดงจำนวนต่อรุ่นบน UI (endpoint คืน count ไว้ให้ แต่ UI v1 โชว์แค่ชื่อรุ่น) · แตะปุ่ม "เรียง"/custom listbox เดิม · ลบ SortDropdown.tsx ที่ dead (นอก scope)

## ดีไซน์

### A. Backend — extract base-where + model filter (shop-catalog.service.ts)

**A1. `shopBaseWhere()`** — helper คืน predicate iPhone-only + in-stock (category = ทุก phone):
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
`listGroupedByModel` refactor: `const where: any = { ...shopBaseWhere() };` แล้ว override `category` เมื่อมี `filters.condition` (พฤติกรรมเดิมทุกอย่าง — behavior-preserving)

**A2. model filter** — เพิ่มใน `listGroupedByModel` where:
```ts
if (filters.model) where.model = filters.model;
```
+ `model?: string` ใน filters param + `ListProductsDto` (`@IsOptional() @IsString() @MaxLength(60)`)

**A3. `listAvailableModels()`** — method ใหม่:
```ts
async listAvailableModels(): Promise<{ model: string; count: number }[]> {
  const rows = await this.prisma.product.groupBy({
    by: ['model'],
    where: shopBaseWhere(),
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  return rows.map((r) => ({ model: r.model, count: r._count?.id ?? 0 }));
}
```

### B. Backend — endpoint (shop-catalog.controller.ts)
```ts
@Get('models')
async models() {
  return this.catalogService.listAvailableModels();
}
```
(อยู่ใต้ `@Controller('shop')` + `ShopBotDefenseGuard` เดิม — public เหมือน list)

### C. Frontend (CatalogPage.tsx + FilterSidebar type)
- `CatalogFilters` เพิ่ม `model?: string`
- `useQuery(['shop','models'])` → `api.get('/api/shop/models')` → `{ model, count }[]`
- native `<select>` ในแถบกรอง ถัดจากปุ่มสภาพเครื่อง:
```tsx
<select
  aria-label="กรองตามรุ่น"
  value={filters.model ?? ''}
  onChange={(e) => updateFilters({ ...filters, model: e.target.value || undefined })}
  className="px-3 py-1.5 text-[13px] rounded-full border border-border bg-background text-foreground leading-snug"
>
  <option value="">ทุกรุ่น</option>
  {models?.map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
</select>
```
- `model` เข้า state + URL sync (`?model=`) แบบเดียวกับ `condition`/`search` (ใน `updateFilters` + initial state + effect) + ส่งเข้า list queryFn (`if (filters.model) params.set('model', filters.model)`)

## ไฟล์ที่แตะ
- api: `dto/list-products.dto.ts`, `shop-catalog.service.ts`, `shop-catalog.controller.ts`, `shop-catalog.service.spec.ts`
- web-shop: `pages/CatalogPage.tsx`, `components/catalog/FilterSidebar.tsx` (แค่ `CatalogFilters` type)

## Testing (TDD, jest mock-prisma)
`shop-catalog.service.spec.ts`:
1. `filters.model='iPhone 16'` → groupBy where มี `model: 'iPhone 16'` (+ base iPhone-only ยังอยู่)
2. `listAvailableModels()` → groupBy `by:['model']`, where = base iPhone-only (Apple + phone-cat + IN_STOCK + isOnlineVisible), orderBy `_count.id desc`; map เป็น `{model,count}`
3. refactor `shopBaseWhere` behavior-preserving: test เดิมของ list (iPhone-only where) ยังผ่านครบ
frontend: tsc + build เขียว

## Owner data-dependencies
ไม่มี (ใช้รุ่นจากสต็อกจริง) — รุ่นจะโผล่เองเมื่อมีสินค้า

## Risks
ไม่มี migration; refactor base-where = behavior-preserving (มี test คุม); rollback = revert
