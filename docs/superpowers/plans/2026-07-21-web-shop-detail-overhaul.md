# Web-shop Product Detail Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** ยกเครื่องหน้า `/products/:id` ให้แสดงข้อมูลเครื่องครบ (สเปก/รูป+ซูม+360/เลือกเครื่อง/สต็อก/breadcrumb/รุ่นใกล้เคียง) แบบ conditional (ติดสว่างเมื่อมี data)

**Architecture:** Backend เพิ่ม field ต่อ unit + endpoint related (reuse `shopBaseWhere`). Frontend แตกเป็น 6 component ใหม่ใน `components/catalog/` + shared type ใน `types/product.ts` แล้ว integrate ใน ProductDetailPage (selectedUnit state + re-key installment 2 query). ไม่มี schema/migration.

**Tech Stack:** NestJS + Prisma (jest mock-prisma) · React + Vite + React Query + Radix Dialog (tsc+build)

## Global Constraints

- ห้ามแก้ schema / ไม่มี migration
- `costPrice` ห้ามหลุด (ใช้ cashPrice/installmentPrice เท่านั้น)
- ทุก section **conditional** — ไม่ render / ไม่พังเมื่อ field เป็น null/undefined/[]
- reuse: `Dialog` (`variant="fullscreen"`), `InstallmentCalculatorCard` (prop productId/cashPrice/installmentPrice), `ProductCard`, `StockIndicator`, `shopBaseWhere()`, `GROUP_BY`, `smartStockCount()`
- shared type `ProductUnit` อยู่ `apps/web-shop/src/types/product.ts` — import ในทุก component ที่ใช้ (ห้าม duplicate)
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2 — `npx prettier --write` ก่อน commit
- api test: `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts`
- web-shop verify: `cd apps/web-shop && npx tsc --noEmit && npm run build`

---

### Task 1: Backend — `getProductDetail` unit +color/hasCharger/hasHeadphones/installmentPrice

**Files:** Modify `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` · Test `.../shop-catalog.service.spec.ts`

**Interfaces produced:** `ProductUnit` (backend) gains `color?: string`, `installmentPrice: number | null`; push includes hasCharger/hasHeadphones/color/installmentPrice.

- [ ] **Step 1: test ล้มก่อน** — เพิ่มใน `describe('getProductDetail')`:

```ts
    it('returns per-unit color, charger, headphones, installmentPrice', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', brand: 'Apple', model: 'iPhone 15', storage: '128GB', color: 'Black',
        category: 'PHONE_USED', cashPrice: 15900, conditionGrade: 'A',
        gallery: [], gallery360: [], isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'u1', conditionGrade: 'A', batteryHealth: 92, hasBox: true, hasCharger: true,
          hasHeadphones: false, shopWarrantyDays: 30, color: 'Blue', cashPrice: 15900,
          installmentPrice: 17500, imeiSerial: '111122223333', gallery: [], gallery360: [] },
      ]);
      const result = await service.getProductDetail('p1');
      const u = result!.tiers.A.units[0];
      expect(u.color).toBe('Blue');
      expect(u.hasCharger).toBe(true);
      expect(u.hasHeadphones).toBe(false);
      expect(u.installmentPrice).toBe(17500);
      expect(JSON.stringify(result)).not.toContain('costPrice');
    });
```

- [ ] **Step 2: รัน red** — `cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t "per-unit color"` → FAIL

- [ ] **Step 3: แก้ interface + push**

ใน `ProductUnit` interface เพิ่มหลัง `hasHeadphones?: boolean;`:
```ts
  color?: string;
```
และเปลี่ยน/เพิ่ม: หลัง `cashPrice: number;` เพิ่ม:
```ts
  installmentPrice: number | null;
```

ใน loop push units (หลัง `hasBox: u.hasBox ?? undefined,`) เพิ่ม:
```ts
        hasCharger: u.hasCharger ?? undefined,
        hasHeadphones: u.hasHeadphones ?? undefined,
        color: u.color ?? undefined,
        installmentPrice: u.installmentPrice != null ? Number(u.installmentPrice) : null,
```

- [ ] **Step 4: รัน green** — `... npx jest ...service.spec.ts` → PASS ทั้งไฟล์

- [ ] **Step 5: prettier + commit** — `npx prettier --write` 2 ไฟล์ แล้ว:
```bash
git commit -m "feat(shop-catalog): return per-unit color/charger/headphones/installmentPrice in detail"
```

---

### Task 2: Backend — `GET /api/shop/products/:id/related`

**Files:** Modify `shop-catalog.service.ts`, `shop-catalog.controller.ts` · Test `.spec.ts`

**Interfaces produced:** `listRelated(productId): Promise<ProductGroup[]>`; route `GET shop/products/:id/related` → ProductGroup[] (+stock via controller)

- [ ] **Step 1: test ล้มก่อน**

```ts
  describe('listRelated', () => {
    it('returns other models (iPhone-only base, excludes current model, limit 6)', async () => {
      prisma.product.findFirst.mockResolvedValueOnce({ id: 'p1', model: 'iPhone 16' });
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_USED', _min: { cashPrice: 14000 }, _count: { id: 2 } },
      ]);
      prisma.product.findFirst.mockResolvedValueOnce({ id: 'rep', gallery: [], conditionGrade: 'A' });

      const result = await service.listRelated('p1');

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['brand', 'model', 'storage', 'category'],
          where: expect.objectContaining({ brand: 'Apple', model: { not: 'iPhone 16' } }),
          take: 6,
        }),
      );
      expect(result[0].model).toBe('iPhone 15');
    });

    it('returns [] when product not found', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(null);
      expect(await service.listRelated('missing')).toEqual([]);
    });
  });
```

- [ ] **Step 2: รัน red** → FAIL (method not defined)

- [ ] **Step 3: Service — `listRelated`** (วางหลัง `listAvailableModels`):

```ts
  async listRelated(productId: string): Promise<ProductGroup[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...shopBaseWhere() },
    });
    if (!product) return [];
    const where = { ...shopBaseWhere(), model: { not: product.model } };
    const groups = await this.prisma.product.groupBy({
      by: [...GROUP_BY],
      where,
      _min: { cashPrice: true },
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' as const } }],
      take: 6,
    });
    return Promise.all(
      groups.map(async (g) => {
        const sample = await this.prisma.product.findFirst({
          where: { ...where, brand: g.brand, model: g.model, storage: g.storage, category: g.category },
          orderBy: { cashPrice: 'asc' },
          select: { id: true, gallery: true, conditionGrade: true },
        });
        const minPrice = g._min?.cashPrice != null ? Number(g._min.cashPrice) : null;
        const monthly =
          minPrice != null ? this.calculateMonthlyPayment(minPrice, DEFAULT_MONTHS, DEFAULT_DOWN_PCT) : 0;
        return {
          id: sample?.id ?? '',
          brand: g.brand,
          model: g.model,
          storage: g.storage ?? undefined,
          minPrice,
          stockCount: g._count?.id ?? 0,
          thumbnailUrl: sample?.gallery[0],
          conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
          monthlyPaymentFrom: monthly,
          condition: g.category === 'PHONE_NEW' ? 'NEW' : 'USED',
        };
      }),
    );
  }
```

- [ ] **Step 4: Controller** — เพิ่มหลัง `models()`:

```ts
  @Get('products/:id/related')
  async related(@Param('id') id: string) {
    const groups = await this.catalogService.listRelated(id);
    return groups.map((g) => ({ ...g, stock: this.catalogService.smartStockCount(g.stockCount) }));
  }
```
(path `products/:id/related` ลึกกว่า `products/:id` — NestJS แยก route ได้)

- [ ] **Step 5: รัน green** → PASS

- [ ] **Step 6: prettier + commit**
```bash
git commit -m "feat(shop-catalog): GET /products/:id/related — other models via shopBaseWhere"
```

---

### Task 3: Frontend — shared type + Breadcrumb + SpecTable

**Files:** Modify `apps/web-shop/src/types/product.ts` · Create `apps/web-shop/src/components/catalog/Breadcrumb.tsx`, `SpecTable.tsx`

**Interfaces produced:** `ProductUnit` (frontend shared type); `<Breadcrumb items={{label,to?}[]} />`; `<SpecTable unit={ProductUnit} storage?={string} isNew={boolean} />`

- [ ] **Step 1: shared type** — เพิ่มใน `types/product.ts`:
```ts
export interface ProductUnit {
  id: string;
  conditionGrade: string;
  batteryHealth?: number;
  hasBox?: boolean;
  hasCharger?: boolean;
  hasHeadphones?: boolean;
  shopWarrantyDays?: number;
  color?: string;
  cashPrice: number;
  installmentPrice: number | null;
  imeiPartial?: string;
  gallery: string[];
  gallery360: string[];
}
```

- [ ] **Step 2: Breadcrumb.tsx**
```tsx
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground leading-snug">
      {items.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3" aria-hidden />}
          {c.to ? (
            <Link to={c.to} className="hover:text-foreground hover:underline underline-offset-2">
              {c.label}
            </Link>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: SpecTable.tsx** — conditional rows (แสดงเฉพาะ field ที่มีค่า)
```tsx
import type { ProductUnit } from '@/types/product';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border last:border-0 text-sm leading-snug">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right font-medium">{value}</span>
    </div>
  );
}

export function SpecTable({
  unit,
  storage,
  isNew,
}: {
  unit: ProductUnit;
  storage?: string;
  isNew: boolean;
}) {
  const accessories = [
    unit.hasBox && 'กล่อง',
    unit.hasCharger && 'สายชาร์จ',
    unit.hasHeadphones && 'หูฟัง',
  ].filter(Boolean) as string[];

  const rows: Array<{ label: string; value: string } | null> = [
    storage ? { label: 'ความจุ', value: storage } : null,
    unit.color ? { label: 'สี', value: unit.color } : null,
    !isNew && unit.batteryHealth != null
      ? { label: 'สุขภาพแบตเตอรี่', value: `${unit.batteryHealth}%` }
      : null,
    accessories.length ? { label: 'อุปกรณ์ในกล่อง', value: accessories.join(' · ') } : null,
    unit.shopWarrantyDays != null
      ? { label: 'ประกันร้าน', value: `${unit.shopWarrantyDays} วัน` }
      : null,
    unit.imeiPartial ? { label: 'IMEI', value: unit.imeiPartial } : null,
  ];
  const visible = rows.filter((r): r is { label: string; value: string } => r !== null);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border p-4 md:p-5">
      <h2 className="font-semibold text-base mb-1 leading-snug">รายละเอียดเครื่อง</h2>
      <div>
        {visible.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: tsc + build** — `cd apps/web-shop && npx tsc --noEmit && npm run build` (component ยังไม่ถูก import ที่ไหน แต่ต้อง compile ได้)

- [ ] **Step 5: prettier + commit**
```bash
git commit -m "feat(web-shop): shared ProductUnit type + Breadcrumb + SpecTable components"
```

---

### Task 4: Frontend — UnitPicker

**Files:** Create `apps/web-shop/src/components/catalog/UnitPicker.tsx`

**Interfaces produced:** `<UnitPicker units={ProductUnit[]} selectedId={string} onSelect={(id)=>void} isNew={boolean} />`

- [ ] **Step 1: UnitPicker.tsx** — chips เลือกเครื่อง (โชว์เกรด[ถ้ามือสอง]/สี/แบต/ราคา)
```tsx
import type { ProductUnit } from '@/types/product';
import { cn } from '@/lib/utils';

function unitLabel(u: ProductUnit, isNew: boolean): string {
  const parts = [
    !isNew && u.conditionGrade && u.conditionGrade !== 'unknown' ? `เกรด ${u.conditionGrade}` : null,
    u.color || null,
    !isNew && u.batteryHealth != null ? `แบต ${u.batteryHealth}%` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'เครื่องนี้';
}

export function UnitPicker({
  units,
  selectedId,
  onSelect,
  isNew,
}: {
  units: ProductUnit[];
  selectedId: string;
  onSelect: (id: string) => void;
  isNew: boolean;
}) {
  if (units.length <= 1) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground leading-snug">เลือกเครื่อง ({units.length})</p>
      <div className="flex flex-wrap gap-2">
        {units.map((u) => {
          const active = u.id === selectedId;
          return (
            <button
              key={u.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(u.id)}
              className={cn(
                'flex flex-col items-start px-3 py-2 rounded-xl border text-left transition-colors leading-snug',
                active
                  ? 'border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50'
                  : 'border-border hover:border-foreground/40',
              )}
            >
              <span className="text-[13px] font-medium text-foreground">{unitLabel(u, isNew)}</span>
              <span className="num text-sm text-emerald-600 font-semibold">
                {u.cashPrice > 0 ? `฿${u.cashPrice.toLocaleString()}` : 'สอบถามราคา'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + build** เขียว

- [ ] **Step 3: prettier + commit**
```bash
git commit -m "feat(web-shop): UnitPicker component (selectable units)"
```

---

### Task 5: Frontend — ImageLightbox (Dialog fullscreen zoom)

**Files:** Create `apps/web-shop/src/components/catalog/ImageLightbox.tsx`

**Interfaces produced:** `<ImageLightbox images={string[]} open={boolean} index={number} onOpenChange={(o)=>void} onIndexChange={(i)=>void} alt={string} />`

- [ ] **Step 1: ImageLightbox.tsx** — Dialog variant fullscreen + zoom toggle (คลิกสลับ 1x/2x) + prev/next
```tsx
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent } from '@/components';

export function ImageLightbox({
  images,
  open,
  index,
  onOpenChange,
  onIndexChange,
  alt,
}: {
  images: string[];
  open: boolean;
  index: number;
  onOpenChange: (o: boolean) => void;
  onIndexChange: (i: number) => void;
  alt: string;
}) {
  const [zoom, setZoom] = useState(false);
  const src = images[index] ?? images[0];
  const go = (d: number) => {
    setZoom(false);
    onIndexChange((index + d + images.length) % images.length);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullscreen" className="p-0 bg-background/95 items-center justify-center">
        <div className="relative flex-1 w-full flex items-center justify-center overflow-auto">
          <img
            src={src}
            alt={alt}
            onClick={() => setZoom((z) => !z)}
            className={
              zoom
                ? 'max-w-none max-h-none w-auto h-auto cursor-zoom-out scale-[2] origin-center transition-transform'
                : 'max-h-full max-w-full object-contain cursor-zoom-in transition-transform'
            }
          />
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="รูปก่อนหน้า"
                onClick={() => go(-1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-background/80 border border-border flex items-center justify-center"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label="รูปถัดไป"
                onClick={() => go(1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-background/80 border border-border flex items-center justify-center"
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs bg-background/80 border border-border rounded-full px-3 py-1 leading-snug">
                {index + 1} / {images.length}
              </span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
Note: ตรวจว่า `Dialog`, `DialogContent` export จาก `@/components` (barrel) — ถ้าไม่ ให้ import จาก `@/components/ui/dialog`

- [ ] **Step 2: tsc + build** เขียว (ยืนยัน DialogContent รับ prop `variant="fullscreen"`)

- [ ] **Step 3: prettier + commit**
```bash
git commit -m "feat(web-shop): ImageLightbox (fullscreen zoom via Dialog)"
```

---

### Task 6: Frontend — Product360Viewer (drag-spin)

**Files:** Create `apps/web-shop/src/components/catalog/Product360Viewer.tsx`

**Interfaces produced:** `<Product360Viewer frames={string[]} alt={string} />`

- [ ] **Step 1: Product360Viewer.tsx** — drag/touch เลื่อน frame index
```tsx
import { useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';

export function Product360Viewer({ frames, alt }: { frames: string[]; alt: string }) {
  const [frame, setFrame] = useState(0);
  const dragRef = useRef<{ startX: number; startFrame: number } | null>(null);

  if (frames.length === 0) return null;

  const setFromDelta = (dx: number, startFrame: number) => {
    const step = Math.round(dx / 8); // 8px ต่อ 1 frame
    const next = (((startFrame + step) % frames.length) + frames.length) % frames.length;
    setFrame(next);
  };
  const onDown = (x: number) => (dragRef.current = { startX: x, startFrame: frame });
  const onMove = (x: number) => {
    if (dragRef.current) setFromDelta(x - dragRef.current.startX, dragRef.current.startFrame);
  };
  const onUp = () => (dragRef.current = null);

  return (
    <div
      className="relative aspect-square w-full rounded-2xl bg-zinc-50 overflow-hidden flex items-center justify-center touch-none select-none cursor-ew-resize"
      onMouseDown={(e) => onDown(e.clientX)}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchStart={(e) => onDown(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={onUp}
    >
      <img
        src={frames[frame]}
        alt={`${alt} 360° เฟรม ${frame + 1}`}
        className="max-h-full max-w-full object-contain pointer-events-none"
        draggable={false}
      />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 text-xs bg-background/80 border border-border rounded-full px-3 py-1 leading-snug">
        <RotateCw className="size-3.5" aria-hidden /> ลากเพื่อหมุน 360°
      </span>
    </div>
  );
}
```

- [ ] **Step 2: tsc + build** เขียว

- [ ] **Step 3: prettier + commit**
```bash
git commit -m "feat(web-shop): Product360Viewer (drag-to-spin)"
```

---

### Task 7: Frontend — RelatedSection

**Files:** Create `apps/web-shop/src/components/catalog/RelatedSection.tsx`

**Interfaces produced:** `<RelatedSection productId={string} />` (fetch /related, ProductCard grid; null เมื่อว่าง)

- [ ] **Step 1: RelatedSection.tsx**
```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Container, ProductCard, type ProductGroup } from '@/components';

export function RelatedSection({ productId }: { productId: string }) {
  const { data } = useQuery<ProductGroup[]>({
    queryKey: ['shop', 'related', productId],
    queryFn: () => api.get(`/api/shop/products/${productId}/related`).then((r) => r.data),
    enabled: !!productId,
    staleTime: 5 * 60_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <Container>
      <h2 className="font-display text-xl md:text-2xl font-semibold mb-5 leading-snug">รุ่นใกล้เคียง</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-6 md:gap-x-6">
        {data.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </Container>
  );
}
```
Note: ยืนยัน `ProductGroup` export จาก `@/components` (ProductCard.tsx export ผ่าน barrel) — ตอนนี้ `type ProductGroup` import แบบนี้ใน CatalogPage ได้อยู่แล้ว

- [ ] **Step 2: tsc + build** เขียว

- [ ] **Step 3: prettier + commit**
```bash
git commit -m "feat(web-shop): RelatedSection (รุ่นใกล้เคียง grid)"
```

---

### Task 8: Frontend — ProductDetailPage integration

**Files:** Modify `apps/web-shop/src/pages/ProductDetailPage.tsx`

**Consumes:** ทุก component จาก Task 3-7 + backend field ใหม่ (Task 1) + related (Task 2)

- [ ] **Step 1: interface + imports** — เปลี่ยน local `ProductUnit` เป็น import จาก `@/types/product`; เพิ่ม `installmentPrice`/`color` ใน interface ให้ตรง (ถ้าใช้ shared type ก็ลบ local); import components ใหม่ (Breadcrumb, SpecTable, UnitPicker, ImageLightbox, Product360Viewer, RelatedSection). แก้ `ProductDetail` interface: `tiers` units ใช้ shared `ProductUnit`.

- [ ] **Step 2: selectedUnit state + flatUnits + re-key installment**

หลัง `const gradeKeys = ...` เพิ่ม:
```ts
  const flatUnits = Object.values(data.tiers).flatMap((t) => t.units);
  const cheapest = flatUnits.reduce<ProductUnit | undefined>(
    (min, u) => (min == null || u.cashPrice < min.cashPrice ? u : min),
    undefined,
  );
```
เพิ่ม state (บนสุดของ component กับ hooks อื่น): `const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);`
derived: `const selectedUnit = flatUnits.find((u) => u.id === selectedUnitId) ?? cheapest;`
เปลี่ยน hero preview query ให้ re-key ด้วย selectedUnit:
```ts
  const previewId = selectedUnit?.id ?? id;
  const { data: preview } = useQuery({
    queryKey: ['shop-product-preview', previewId],
    queryFn: () =>
      api
        .get(`/api/shop/installment-preview?productId=${previewId}&months=12&downPct=0.15&provider=BC`)
        .then((r) => r.data as { available: boolean; monthlyPayment?: number }),
    enabled: !!previewId && !!selectedUnit?.installmentPrice,
  });
```
⚠️ hooks ต้องเรียกก่อน early-return (loading) — ปรับให้ `selectedUnit`/`flatUnits` คำนวณจาก `data?.tiers ?? {}` แบบ null-safe เพื่อวางไว้บนได้ (หรือคง preview query keyed by `id` ถ้าจัด hook order ยาก แล้ว re-key เฉพาะ InstallmentCalculatorCard — **ยอมรับได้ถ้า hero "ผ่อนเริ่ม" ใช้ representative** แต่เป้าหมายคือ sync; implementer จัด hook order ให้ถูก rules-of-hooks)

- [ ] **Step 3: price + spec + picker จาก selectedUnit**

- ราคา: ใช้ `selectedUnit?.cashPrice ?? 0` แทน `lowestPrice(data.tiers)`
- แทรกหลัง badge block: `<UnitPicker units={flatUnits} selectedId={selectedUnit?.id ?? ''} onSelect={setSelectedUnitId} isNew={isNew} />`
- แทรก `<SpecTable unit={selectedUnit} storage={data.storage} isNew={isNew} />` (ถ้า selectedUnit) ในคอลัมน์รายละเอียด (ก่อน description หรือหลัง)
- InstallmentCalculatorCard: `productId={selectedUnit?.id ?? data.id}` `cashPrice={selectedUnit?.cashPrice ?? data.cashPrice}` `installmentPrice={selectedUnit?.installmentPrice ?? data.installmentPrice}`

- [ ] **Step 4: stock + breadcrumb**

- Breadcrumb บนสุด (ใน Container ก่อน grid): `<Breadcrumb items={[{ label: 'หน้าแรก', to: '/' }, { label: 'สินค้าทั้งหมด', to: '/products' }, { label: data.model }]} />`
- stock: `const stockCount = flatUnits.length;` โชว์ `<StockIndicator display={stockCount <= 3 ? \`เหลือ ${stockCount} เครื่อง — ใกล้หมด\` : \`เหลือ ${stockCount} เครื่อง\`} tone={stockCount <= 3 ? 'urgent' : 'low'} />` ใกล้ราคา (import StockIndicator)

- [ ] **Step 5: gallery — ปลดล็อก + lightbox + 360**

- thumbnails: เอา `.slice(0, 5)` ออก (โชว์ทั้งหมด) — คง grid-cols-5 (wrap เอง)
- main image: ครอบด้วยปุ่มเปิด lightbox: `onClick={() => setLightboxOpen(true)}` + cursor-zoom-in; เพิ่ม state `const [lightboxOpen, setLightboxOpen] = useState(false);`
- `<ImageLightbox images={gallery} open={lightboxOpen} index={activeImage} onOpenChange={setLightboxOpen} onIndexChange={setActiveImage} alt={displayName} />`
- 360: ถ้า `data.gallery360.length > 0` → toggle "รูป / 360°" (state `view360`) แสดง `<Product360Viewer frames={data.gallery360} alt={displayName} />` แทน gallery

- [ ] **Step 6: new/used + related**

- badge/เกรด: `isNew` logic คงเดิม (Task ก่อนหน้าทำแล้ว) — เพิ่ม `{isNew && <span>เครื่องใหม่ · ประกันศูนย์</span>}` เป็น chip เสริม (optional copy)
- ท้ายหน้า ก่อน `<StickyBottomBar>`: `<Section padding="md"><RelatedSection productId={id!} /></Section>`

- [ ] **Step 7: tsc + build** — `cd apps/web-shop && npx tsc --noEmit && npm run build` เขียว; ตรวจ rules-of-hooks (hooks ก่อน early return) + ไม่มี reference `lowestPrice` ค้างถ้าเลิกใช้

- [ ] **Step 8: prettier + commit**
```bash
git commit -m "feat(web-shop): integrate detail overhaul — unit picker, spec table, gallery zoom/360, breadcrumb, stock, related"
```

---

### Task 9: Verify รวม

- [ ] **Step 1: api** — `cd apps/api && npx jest src/modules/shop-catalog && npx tsc --noEmit -p tsconfig.json` เขียว
- [ ] **Step 2: web-shop** — `cd apps/web-shop && npx tsc --noEmit && npm run build` เขียว
- [ ] **Step 3: Manual smoke (ถ้า local + มี data):** breadcrumb; gallery คลิกซูม lightbox prev/next; 360 หมุน (ถ้ามี frames); unit picker เปลี่ยน→ราคา+ผ่อน+สเปก sync; spec table conditional (ซ่อน row null); stock; related grid (ถ้ามี ≥2 รุ่น); ใหม่ vs มือสอง ต่างกัน

## Self-Review

**Spec coverage:** B1→T1, B2→T2, F1 breadcrumb→T3/T8, F2 gallery/zoom/360→T5/T6/T8, F3 unit picker→T4/T8, F4 spec table→T3/T8, F5 stock→T8, F6 new/used→T8, F7 related→T7/T8 ✅
**Placeholder scan:** ไม่มี TBD; ทุก step มีโค้ด/คำสั่ง ✅ (T8 step 2 note เรื่อง hook-order เป็น implementer guidance ไม่ใช่ placeholder)
**Type consistency:** shared `ProductUnit` (types/product.ts) ใช้ทั้ง SpecTable/UnitPicker/ProductDetailPage; `ProductGroup` reuse จาก ProductCard barrel (RelatedSection); backend ProductUnit +color/installmentPrice ตรงกับ frontend shared type ✅

## Post-implementation (owner data — ทำให้ติดสว่าง)
รูป gallery, gallery360, cashPrice/installmentPrice, batteryHealth/hasCharger/hasHeadphones/สี/ประกัน ต่อเครื่อง, ≥2 รุ่น (related)
