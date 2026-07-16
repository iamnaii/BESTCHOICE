# Web-Shop Track A — Online Listing (Photo-Picker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ร้านเลือกรูปที่มีอยู่แล้วของเครื่อง (จากการตรวจรับ/รูป 6 ด้าน) ส่งขึ้นเว็บ shop + เปิด/ปิดการแสดงบนเว็บ + ใส่คำอธิบาย — โดยไม่ต้องถ่ายรูปใหม่

**Architecture:** รูปเดิมทั้งสองชุด (`Product.photos[]` จาก GoodsReceiving และ `ProductPhoto` 6 ด้าน) เป็น **base64 data-URL ใน Postgres** แต่ `Product.gallery` ที่เว็บ shop อ่านต้องเป็น **public object-storage URL** (shop-catalog ส่งค่า verbatim ไม่ sign) → การ "เลือก" จึงเป็นการ **โปรโมทฝั่ง server**: decode base64 → `StorageService.upload()` → `getPublicUrl()` → append เข้า `gallery` แยกเป็น endpoint `POST /products/:id/online-listing/photos` ส่วน `PATCH /products/:id/online-listing` เป็น metadata ล้วน (reorder/remove gallery + toggle + description) — **ไม่แตะ** `UpdateProductDto`/`PATCH /products/:id` เดิม UI = แท็บใหม่ "ขึ้นเว็บ" ใน ProductDetailPage ของ apps/web

**Tech Stack:** NestJS+Prisma (module `products` — เพิ่ม service ใหม่ตาม pattern หลาย service ต่อ module), React+react-query (apps/web, shadcn/tokens), jest (apps/api)

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-web-shop-launch-roadmap-design.md` (Track A ฉบับ photo-picker) — **ปรับจาก spec 1 จุดตามข้อเท็จจริงโค้ด:** spec เขียนว่า gallery รับ "subset ของ URL ที่มีอยู่ใน photos[]+ProductPhoto" แต่ของจริงเป็น base64 → จึงแยก promote-endpoint (เจตนาเดิมคงไว้: เลือกจากรูปที่มี ไม่ถ่ายใหม่ + ห้าม URL นอกระบบ)
- นิยาม "พร้อมขึ้นเว็บ": `gallery ≥ 1` เสมอ + `conditionGrade` ไม่ว่าง **เฉพาะ category `PHONE_USED`** (เครื่องใหม่/อุปกรณ์ไม่มีเกรดโดยธรรมชาติ) — API ปฏิเสธ `isOnlineVisible=true` ถ้าไม่ครบ (BadRequestException ข้อความไทย); ปิด/แก้ field อื่นได้เสมอ
- gallery สูงสุด **8 รูป**; key รูปใหม่ = `shop/product-gallery/<productId>/<uuid>.<ext>`
- Roles ทั้งสอง endpoint: `OWNER, BRANCH_MANAGER` (ตาม gate ของ PATCH /products/:id เดิม); UI แสดง read-only ถ้าไม่ใช่สอง role นี้ (`isManager` เดิมในหน้า)
- apps/web: tokens เท่านั้น (bg-card/text-muted-foreground/…), Thai `leading-snug`, react-query + `@/lib/api`, toast จาก sonner — ห้าม dependency ใหม่ (จัดเรียงรูปใช้ปุ่มขึ้น/ลง ไม่ใช้ drag-n-drop lib)
- เทสต์: apps/api jest ตาม pattern `products.service.spec.ts` (hand-rolled prisma mock, assert exact update args); apps/web ไม่มี norm เทสต์ระดับ panel → verify ด้วย tsc + browser จริง
- ฐาน branch: `origin/main` (785c02aab+) ตรง ๆ — ไม่ stacked แล้ว; ทำงานใน worktree + symlink `node_modules` (root + apps/api + apps/web + apps/web-shop)
- commit แรก = ไฟล์ plan นี้

---

### Task 0: ตั้ง branch + commit plan

**Files:** Create (commit): `docs/superpowers/plans/2026-07-16-web-shop-track-a-online-listing.md`

- [ ] **Step 1:** `git fetch origin && git worktree add -b feat/web-shop-track-a-listing <scratchpad>/wt-track-a origin/main`
- [ ] **Step 2:** symlink node_modules 4 จุดจาก checkout หลัก (root, apps/api, apps/web, apps/web-shop)
- [ ] **Step 3:** copy plan จาก checkout หลัก → `git add docs && git commit -m "docs(web-shop): plan Track A — online listing photo-picker"`

---

### Task 1: API — DTO + service + controller + เทสต์ (TDD)

**Files:**
- Create: `apps/api/src/modules/products/dto/online-listing.dto.ts`
- Create: `apps/api/src/modules/products/products-online-listing.service.ts`
- Create: `apps/api/src/modules/products/products-online-listing.service.spec.ts`
- Modify: `apps/api/src/modules/products/products.controller.ts` (เพิ่ม 2 route)
- Modify: `apps/api/src/modules/products/products.module.ts` (register service)

**Interfaces:**
- Consumes: `PrismaService`, `StorageService.upload(key, buffer, contentType)` (storage.service.ts:70, StorageModule เป็น @Global → inject ได้เลย), `StorageService.getPublicUrl(key)`
- Produces (Task 2 ใช้): `PATCH /products/:id/online-listing` body `{ gallery?: string[]; isOnlineVisible?: boolean; onlineDescription?: string }` → product ที่อัปเดตแล้ว; `POST /products/:id/online-listing/photos` body `{ source: 'LEGACY'|'ANGLE'; index?: number; angle?: 'front'|'back'|'left'|'right'|'top'|'bottom' }` → `{ gallery: string[] }`

- [ ] **Step 1: เขียน DTO**

```ts
// apps/api/src/modules/products/dto/online-listing.dto.ts
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class UpdateOnlineListingDto {
  /** จัดเรียง/ลบรูปที่อยู่ใน gallery เดิมเท่านั้น — เพิ่มรูปใหม่ต้องผ่าน endpoint promote */
  @IsOptional() @IsArray() @IsUrl({ require_tld: false }, { each: true })
  gallery?: string[];

  @IsOptional() @IsBoolean()
  isOnlineVisible?: boolean;

  @IsOptional() @IsString() @MaxLength(2000, { message: 'คำอธิบายยาวเกิน 2000 ตัวอักษร' })
  onlineDescription?: string;
}

export const PHOTO_ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];

export class PromoteListingPhotoDto {
  @IsEnum(['LEGACY', 'ANGLE'], { message: 'source ต้องเป็น LEGACY หรือ ANGLE' })
  source!: 'LEGACY' | 'ANGLE';

  /** ใช้เมื่อ source=LEGACY — index ใน Product.photos */
  @IsOptional() @IsInt() @Min(0)
  index?: number;

  /** ใช้เมื่อ source=ANGLE — ด้านจาก ProductPhoto */
  @IsOptional() @IsEnum(PHOTO_ANGLES)
  angle?: PhotoAngle;
}
```

- [ ] **Step 2: เขียนเทสต์ให้ FAIL ก่อน** — สร้าง spec ตาม pattern `products.service.spec.ts` (hand-rolled mock):

```ts
// apps/api/src/modules/products/products-online-listing.service.spec.ts
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsOnlineListingService } from './products-online-listing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=';

describe('ProductsOnlineListingService', () => {
  let service: ProductsOnlineListingService;
  let prisma: any;
  let storage: any;

  const baseProduct = {
    id: 'p1', category: 'PHONE_USED', conditionGrade: 'A',
    gallery: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    photos: [PNG_B64], isOnlineVisible: false, deletedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn().mockResolvedValue({ ...baseProduct }), update: jest.fn().mockImplementation(({ data }) => ({ ...baseProduct, ...data })) },
      productPhoto: { findUnique: jest.fn().mockResolvedValue({ productId: 'p1', front: PNG_B64, back: null }) },
    };
    storage = {
      upload: jest.fn().mockResolvedValue('shop/product-gallery/p1/x.png'),
      getPublicUrl: jest.fn((key: string) => `https://cdn.example.com/${key}`),
    };
    const module = await Test.createTestingModule({
      providers: [
        ProductsOnlineListingService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(ProductsOnlineListingService);
  });

  describe('updateOnlineListing', () => {
    it('reorders/removes gallery when new list is a subset of the current one', async () => {
      await service.updateOnlineListing('p1', { gallery: ['https://cdn.example.com/b.jpg'] });
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ gallery: ['https://cdn.example.com/b.jpg'] }) }),
      );
    });

    it('rejects gallery entries that are not already in the product gallery', async () => {
      await expect(
        service.updateOnlineListing('p1', { gallery: ['https://evil.example.com/x.jpg'] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('blocks turning isOnlineVisible on when gallery is empty', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, gallery: [] });
      await expect(service.updateOnlineListing('p1', { isOnlineVisible: true })).rejects.toThrow(/รูป/);
    });

    it('blocks turning on for PHONE_USED without conditionGrade', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, conditionGrade: null });
      await expect(service.updateOnlineListing('p1', { isOnlineVisible: true })).rejects.toThrow(/เกรด/);
    });

    it('allows turning on for non-PHONE_USED without grade', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, category: 'ACCESSORY', conditionGrade: null });
      await expect(service.updateOnlineListing('p1', { isOnlineVisible: true })).resolves.toBeDefined();
    });

    it('validates against the INCOMING gallery when both provided (turn on with empty list = reject)', async () => {
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true, gallery: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('turning OFF is always allowed', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, gallery: [], conditionGrade: null, isOnlineVisible: true });
      await expect(service.updateOnlineListing('p1', { isOnlineVisible: false })).resolves.toBeDefined();
    });

    it('throws NotFound for missing/deleted product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.updateOnlineListing('nope', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('promotePhoto', () => {
    it('LEGACY: decodes base64, uploads, appends public URL to gallery', async () => {
      const res = await service.promotePhoto('p1', { source: 'LEGACY', index: 0 });
      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^shop\/product-gallery\/p1\/.+\.png$/), expect.any(Buffer), 'image/png',
      );
      expect(res.gallery).toHaveLength(3);
      expect(res.gallery[2]).toMatch(/^https:\/\/cdn\.example\.com\/shop\/product-gallery\/p1\//);
    });

    it('ANGLE: reads ProductPhoto side', async () => {
      await service.promotePhoto('p1', { source: 'ANGLE', angle: 'front' });
      expect(storage.upload).toHaveBeenCalled();
    });

    it('rejects missing candidate (bad index / empty angle) with Thai message', async () => {
      await expect(service.promotePhoto('p1', { source: 'LEGACY', index: 9 })).rejects.toThrow(/ไม่พบรูป/);
      await expect(service.promotePhoto('p1', { source: 'ANGLE', angle: 'back' })).rejects.toThrow(/ไม่พบรูป/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects when candidate is not a base64 image data-URL', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, photos: ['https://not-base64.example.com/x.jpg'] });
      await expect(service.promotePhoto('p1', { source: 'LEGACY', index: 0 })).rejects.toThrow(BadRequestException);
    });

    it('rejects when gallery already has 8 photos', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, gallery: Array.from({ length: 8 }, (_, i) => `https://cdn.example.com/${i}.jpg`) });
      await expect(service.promotePhoto('p1', { source: 'LEGACY', index: 0 })).rejects.toThrow(/8 รูป/);
    });
  });
});
```

- [ ] **Step 3:** รัน `npx jest src/modules/products/products-online-listing.service.spec.ts --runInBand` → ต้อง FAIL (module ไม่มี)

- [ ] **Step 4: เขียน service**

```ts
// apps/api/src/modules/products/products-online-listing.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PromoteListingPhotoDto, UpdateOnlineListingDto } from './dto/online-listing.dto';

const MAX_GALLERY = 8;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/;
const EXT_BY_MIME: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

@Injectable()
export class ProductsOnlineListingService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  private async findProduct(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    return product;
  }

  async updateOnlineListing(id: string, dto: UpdateOnlineListingDto) {
    const product = await this.findProduct(id);

    if (dto.gallery) {
      const current = new Set(product.gallery);
      const outside = dto.gallery.filter((url) => !current.has(url));
      if (outside.length > 0) {
        throw new BadRequestException('จัดเรียง/ลบได้เฉพาะรูปที่อยู่ในแกลเลอรีเดิม — เพิ่มรูปใหม่ผ่านการเลือกจากรูปในระบบเท่านั้น');
      }
    }

    const effectiveGallery = dto.gallery ?? product.gallery;
    const turningOn = dto.isOnlineVisible === true;
    if (turningOn) {
      if (effectiveGallery.length < 1) {
        throw new BadRequestException('ต้องมีรูปขึ้นเว็บอย่างน้อย 1 รูปก่อนเปิดแสดงบนเว็บ');
      }
      if (product.category === 'PHONE_USED' && !product.conditionGrade) {
        throw new BadRequestException('กรุณาระบุเกรดเครื่องก่อนเปิดแสดงบนเว็บ');
      }
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.gallery !== undefined ? { gallery: dto.gallery } : {}),
        ...(dto.isOnlineVisible !== undefined ? { isOnlineVisible: dto.isOnlineVisible } : {}),
        ...(dto.onlineDescription !== undefined ? { onlineDescription: dto.onlineDescription } : {}),
      },
    });
  }

  async promotePhoto(id: string, dto: PromoteListingPhotoDto): Promise<{ gallery: string[] }> {
    const product = await this.findProduct(id);
    if (product.gallery.length >= MAX_GALLERY) {
      throw new BadRequestException(`แกลเลอรีขึ้นเว็บได้สูงสุด ${MAX_GALLERY} รูป — ลบรูปเดิมออกก่อน`);
    }

    let candidate: string | null | undefined;
    if (dto.source === 'LEGACY') {
      candidate = dto.index !== undefined ? product.photos[dto.index] : undefined;
    } else {
      const row = await this.prisma.productPhoto.findUnique({ where: { productId: id } });
      candidate = dto.angle && row ? (row as Record<string, unknown>)[dto.angle] as string | null : undefined;
    }
    if (!candidate) throw new BadRequestException('ไม่พบรูปที่เลือก');

    const match = DATA_URL_RE.exec(candidate);
    if (!match) throw new BadRequestException('รูปที่เลือกไม่อยู่ในรูปแบบที่รองรับ');

    const [, mime, b64] = match;
    const buffer = Buffer.from(b64, 'base64');
    const key = `shop/product-gallery/${id}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
    await this.storage.upload(key, buffer, `image/${mime}`);
    const publicUrl = this.storage.getPublicUrl(key);

    const gallery = [...product.gallery, publicUrl];
    await this.prisma.product.update({ where: { id }, data: { gallery } });
    return { gallery };
  }
}
```

- [ ] **Step 5:** รัน spec → PASS ทั้งหมด (ปรับ service จน gree n — ห้ามแก้ intent ของเทสต์)

- [ ] **Step 6: ต่อ controller + module** — ใน `products.controller.ts` (ใต้ `PATCH :id` เดิม; import service+DTO; เพิ่มใน constructor):

```ts
  @Patch(':id/online-listing')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateOnlineListing(@Param('id') id: string, @Body() dto: UpdateOnlineListingDto) {
    return this.onlineListing.updateOnlineListing(id, dto);
  }

  @Post(':id/online-listing/photos')
  @Roles('OWNER', 'BRANCH_MANAGER')
  promoteListingPhoto(@Param('id') id: string, @Body() dto: PromoteListingPhotoDto) {
    return this.onlineListing.promotePhoto(id, dto);
  }
```
และเพิ่ม `ProductsOnlineListingService` ใน `providers` ของ `products.module.ts`
⚠️ ระวังลำดับ route: `@Post(':id/online-listing/photos')` ต้องอยู่**ก่อน** route param กว้าง ๆ อื่นถ้ามีการชนกัน (ตรวจไฟล์จริงตอนแทรก)

- [ ] **Step 7:** `npx tsc --noEmit` + `npx jest src/modules/products --runInBand` → เขียวทั้ง module
- [ ] **Step 8:** commit `feat(api): endpoint จัดการรูป/สถานะขึ้นเว็บของสินค้า — photo-picker Track A`

---

### Task 2: UI — แท็บ "ขึ้นเว็บ" ใน ProductDetailPage (apps/web)

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/components/OnlineListingPanel.tsx`
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (Tab union + แท็บ + render panel)

**Interfaces:**
- Consumes: endpoints จาก Task 1 (สัญญาใน Interfaces ของ Task 1); `GET /products/:id/photos` (มีอยู่แล้ว — ProductPhoto 6 ด้าน); prop `product` ที่หน้า detail โหลดไว้แล้ว (มี `photos`, `gallery`, `isOnlineVisible`, `onlineDescription`, `category`, `conditionGrade`); `isManager` gate เดิม (index.tsx:80)

- [ ] **Step 1:** `index.tsx` — `type Tab = 'info' | 'photos' | 'online'`; แสดง tab bar เสมอ (ไม่จำกัด PHONE_USED) โดย 'photos' ยังเฉพาะ PHONE_USED, 'online' เสมอ; label แท็บ = `ขึ้นเว็บ` + render `<OnlineListingPanel product={product} canEdit={isManager} />` เมื่อ active
- [ ] **Step 2:** สร้าง `OnlineListingPanel.tsx` — โครง (โค้ดเต็มให้ implementer เขียนตาม pattern ไฟล์ข้างเคียง `ProductPhotosPanel.tsx` / `EditProductModal.tsx`):
  - ส่วนบน **"รูปที่ขึ้นเว็บ (n/8)"**: grid ของ `product.gallery` แต่ละใบมีปุ่ม ↑ ↓ ลบ (disabled ถ้า !canEdit) — การแก้เก็บใน local state แล้วปุ่ม **บันทึกการจัดเรียง** ยิง `PATCH /products/${id}/online-listing { gallery }`
  - ส่วนกลาง **"เลือกจากรูปในระบบ"**: การ์ดรูปจาก 2 แหล่ง — `product.photos` (badge "ตรวจรับ", ปุ่มส่งขึ้นเว็บ → `POST .../online-listing/photos { source:'LEGACY', index }`) และ `useQuery(['product-photos', id], GET /products/${id}/photos)` 6 ด้าน (badge ชื่อด้านไทย: หน้า/หลัง/ซ้าย/ขวา/บน/ล่าง → `{ source:'ANGLE', angle }`); ปุ่ม disabled เมื่อ gallery ครบ 8; รูปที่โปรโมทแล้วไม่ต้องซ่อน (server กัน dup ไม่ได้ก็ไม่เป็นไร — รูปซ้ำเป็น key ใหม่; แสดง toast สำเร็จ)
  - ส่วนล่าง **สถานะ + คำอธิบาย**: toggle "แสดงบนเว็บ shop" — เมื่อจะเปิดแต่เงื่อนไขไม่ครบ ให้ disabled พร้อมรายการที่ขาด (`ยังไม่มีรูปขึ้นเว็บ` / `ยังไม่ระบุเกรด (เฉพาะมือสอง)`); textarea คำอธิบาย (maxLength 2000) + ปุ่มบันทึก → PATCH
  - ทุก mutation: `queryClient.invalidateQueries(['product', id])` + toast.success/error (ข้อความ error จาก response ของ API); ใช้ tokens + `leading-snug`
- [ ] **Step 3:** `cd apps/web && npx tsc --noEmit` → เขียว (apps/web ใช้ `./tools/check-types.sh web` ได้)
- [ ] **Step 4 (browser):** dev stack local — เปิด `/products/<id ของเครื่อง PHONE_USED ที่มีรูป>` → แท็บขึ้นเว็บ: โปรโมทรูป 1 ใบ (เห็น URL จริงใน grid บน), toggle เปิด (ผ่านเมื่อครบเงื่อนไข), ใส่คำอธิบาย, บันทึก แล้วเช็ค `GET /api/shop/products` เห็น `thumbnailUrl` เป็น URL ที่โปรโมท + เปิดเว็บ shop (:5175 preview จาก main checkout ได้) เห็นรูปจริงบนการ์ด — screenshot ครบ
- [ ] **Step 5:** commit `feat(web): แท็บ ขึ้นเว็บ ใน ProductDetailPage — เลือกรูป/เปิดปิด/คำอธิบายสำหรับเว็บ shop`

---

### Task 3: Final sweep + PR

- [ ] **Step 1:** `npx tsc --noEmit` (api+web) + `npx jest src/modules/products src/modules/storage --runInBand` + browser sweep ซ้ำ flow เต็ม (โปรโมท→เปิด→เห็นบนเว็บ shop→ปิด→หายจากเว็บ)
- [ ] **Step 2:** final whole-branch review (SDD) → แก้ findings
- [ ] **Step 3:** push + `gh pr create --base main` (ไม่ stacked) — body สรุป + ผล verify + note การปรับจาก spec (base64→promote)
- [ ] **Step 4:** ลบ worktree, อัปเดต ledger + memory, รายงาน user (รอ user merge)

## Self-Review (ทำแล้ว)
- Spec coverage: picker จากรูปที่มี ✓ (ปรับเป็น promote — จดเหตุผลใน Global Constraints), toggle+เงื่อนไข ✓ (เกรดเฉพาะ PHONE_USED — refinement จาก spec ที่เขียนรวม), คำอธิบาย ✓, ห้าม URL นอกระบบ ✓ (subset check + promote-only), ไม่มีท่ออัปโหลดใหม่ ✓ (ตัด optional upload ออก — YAGNI, มี ProductPhotosPanel อัปรูปเข้าเครื่องได้อยู่แล้ว)
- Placeholders: Task 2 Step 2 เป็น structured outline เพราะ UI ยาว — ทุก endpoint/prop/เงื่อนไข ระบุครบพอให้ implementer เขียนได้โดยไม่เดา
- Type consistency: DTO/route/body ตรงกันระหว่าง Task 1 Interfaces กับ Task 2 usage
