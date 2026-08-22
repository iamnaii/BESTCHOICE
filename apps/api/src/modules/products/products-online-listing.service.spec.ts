import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProductsOnlineListingService } from './products-online-listing.service';
import { UpdateOnlineListingDto } from './dto/online-listing.dto';
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
      product: {
        findFirst: jest.fn().mockResolvedValue({ ...baseProduct }),
        update: jest.fn().mockImplementation(({ data }) => ({ ...baseProduct, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
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

    it('B0: เปิด isOnlineVisible ได้แม้ยังไม่มีรูป (readiness เป็นคนตัดสินการขึ้นเว็บ)', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, gallery: [] });
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true }),
      ).resolves.toBeDefined();
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isOnlineVisible: true }) }),
      );
    });

    it('B0: เปิด isOnlineVisible ได้แม้มือสองยังไม่มีเกรด', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, conditionGrade: null });
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true }),
      ).resolves.toBeDefined();
    });

    it('allows turning on for non-PHONE_USED without grade', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, category: 'ACCESSORY', conditionGrade: null });
      await expect(service.updateOnlineListing('p1', { isOnlineVisible: true })).resolves.toBeDefined();
    });

    it('B0: เปิดพร้อมส่ง gallery ว่าง ไม่ throw แล้ว (บันทึก gallery ว่าง + เปิดสวิตช์)', async () => {
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true, gallery: [] }),
      ).resolves.toBeDefined();
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gallery: [], isOnlineVisible: true }),
        }),
      );
    });

    it('turning OFF is always allowed', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, gallery: [], conditionGrade: null, isOnlineVisible: true });
      await expect(service.updateOnlineListing('p1', { isOnlineVisible: false })).resolves.toBeDefined();
    });

    it('throws NotFound for missing/deleted product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.updateOnlineListing('nope', {})).rejects.toThrow(NotFoundException);
    });

    // B0: the visible⇒has-photo invariant moved OUT of this service and into
    // the readiness fragment — the switch itself no longer blocks an
    // already-visible product from clearing its gallery.
    it('B0: PATCH { gallery: [] } บนเครื่องที่เปิดอยู่ = ล้างรูปได้ (เครื่องจะหลุดจากเว็บเองด้วย readiness)', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, isOnlineVisible: true });
      await expect(service.updateOnlineListing('p1', { gallery: [] })).resolves.toBeDefined();
    });

    // Regression (review finding IMPORTANT): duplicate URLs in the incoming
    // gallery must be rejected — defense-in-depth service-level check,
    // independent of the DTO's @ArrayUnique.
    it('rejects a gallery with duplicate URLs', async () => {
      await expect(
        service.updateOnlineListing('p1', {
          gallery: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  describe('UpdateOnlineListingDto — gallery validation', () => {
    async function validateDto(gallery: unknown) {
      const dto = plainToInstance(UpdateOnlineListingDto, { gallery });
      return validate(dto);
    }

    it('rejects duplicate URLs (@ArrayUnique)', async () => {
      const errors = await validateDto(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg']);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects more than 8 URLs (@ArrayMaxSize)', async () => {
      const errors = await validateDto(
        Array.from({ length: 9 }, (_, i) => `https://cdn.example.com/${i}.jpg`),
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts a valid, unique, in-cap gallery', async () => {
      const errors = await validateDto(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
      expect(errors).toHaveLength(0);
    });
  });

  describe('promotePhoto', () => {
    it('LEGACY: decodes base64, uploads, atomically pushes public URL onto gallery via Prisma', async () => {
      // Simulate the DB's post-push state — proves the returned gallery
      // comes from Prisma's atomic result, not an in-memory concat.
      const dbGalleryAfterPush = [...baseProduct.gallery, 'https://cdn.example.com/shop/product-gallery/p1/from-db.png'];
      prisma.product.update.mockResolvedValueOnce({ gallery: dbGalleryAfterPush });

      const res = await service.promotePhoto('p1', { source: 'LEGACY', index: 0 });

      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^shop\/product-gallery\/p1\/.+\.png$/), expect.any(Buffer), 'image/png',
      );
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { gallery: { push: expect.stringMatching(/^https:\/\/cdn\.example\.com\/shop\/product-gallery\/p1\//) } },
        select: { gallery: true },
      });
      // Return value is exactly what the mocked atomic update returned —
      // not `[...product.gallery, publicUrl]` computed locally.
      expect(res.gallery).toBe(dbGalleryAfterPush);
    });

    it('ANGLE: reads ProductPhoto side', async () => {
      prisma.product.update.mockResolvedValueOnce({ gallery: [...baseProduct.gallery, 'https://cdn.example.com/x.png'] });
      await service.promotePhoto('p1', { source: 'ANGLE', angle: 'front' });
      expect(storage.upload).toHaveBeenCalled();
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { gallery: { push: expect.any(String) } }, select: { gallery: true } }),
      );
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

describe('bulkSetVisibility — ส่งขึ้นเว็บทีเดียวหลายเครื่อง', () => {
  let service: ProductsOnlineListingService;
  let prisma: any;

  /** เครื่องที่ข้อมูลครบทุกข้อ พร้อมขึ้นเว็บ */
  const ready = (over: Record<string, unknown> = {}) => ({
    id: 'ready-1',
    name: 'iPhone 15 Pro Max',
    brand: 'Apple',
    category: 'PHONE_USED',
    status: 'IN_STOCK',
    cashPrice: 24900,
    gallery: ['https://cdn.example.com/a.jpg'],
    conditionGrade: 'A',
    isOnlineVisible: false,
    deletedAt: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        ProductsOnlineListingService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(ProductsOnlineListingService);
  });

  const OWNER = { role: 'OWNER', branchId: 'b1' };
  const BM = { role: 'BRANCH_MANAGER', branchId: 'b1' };

  it('เปิดเฉพาะเครื่องที่ยังปิดอยู่ ที่เปิดแล้วไม่นับซ้ำ', async () => {
    prisma.product.findMany.mockResolvedValue([
      ready({ id: 'a', isOnlineVisible: false }),
      ready({ id: 'b', isOnlineVisible: true }),
    ]);

    const res = await service.bulkSetVisibility(
      { isOnlineVisible: true, scope: 'ALL_IN_STOCK' },
      OWNER,
    );

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] } },
      data: { isOnlineVisible: true },
    });
    expect(res).toMatchObject({ matched: 2, changed: 1, alreadySet: 1, willAppear: 2 });
  });

  it('รายงานตามจริงว่าจะขึ้นเว็บกี่เครื่อง และที่เหลือติดอะไร — เปิดสวิตช์ไม่ได้แปลว่าโผล่', async () => {
    prisma.product.findMany.mockResolvedValue([
      ready({ id: 'ok' }),
      ready({ id: 'no-price', cashPrice: null }),
      ready({ id: 'no-photo', gallery: [] }),
      ready({ id: 'no-grade', conditionGrade: null }),
    ]);

    const res = await service.bulkSetVisibility(
      { isOnlineVisible: true, scope: 'ALL_IN_STOCK' },
      OWNER,
    );

    expect(res.matched).toBe(4);
    expect(res.willAppear).toBe(1);
    expect(res.blockedBy).toEqual(
      expect.arrayContaining([
        { reason: 'มีราคาเงินสด', count: 1 },
        { reason: 'มีรูปขึ้นเว็บอย่างน้อย 1 รูป', count: 1 },
        { reason: 'มีเกรดเครื่อง (เฉพาะมือสอง)', count: 1 },
      ]),
    );
  });

  it('ผจก.สาขาแตะได้เฉพาะสาขาตัวเอง', async () => {
    await service.bulkSetVisibility({ isOnlineVisible: true, scope: 'ALL_IN_STOCK' }, BM);
    expect(prisma.product.findMany.mock.calls[0][0].where).toMatchObject({ branchId: 'b1' });
  });

  it('เจ้าของไม่ถูกจำกัดสาขา', async () => {
    await service.bulkSetVisibility({ isOnlineVisible: true, scope: 'ALL_IN_STOCK' }, OWNER);
    expect(prisma.product.findMany.mock.calls[0][0].where.branchId).toBeUndefined();
  });

  it('บัญชีที่ยังไม่ผูกสาขา ทำไม่ได้ — ไม่ปล่อยให้เห็นของทั้งบริษัท', async () => {
    await expect(
      service.bulkSetVisibility(
        { isOnlineVisible: true, scope: 'ALL_IN_STOCK' },
        { role: 'BRANCH_MANAGER', branchId: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('ขอบเขต SELECTED ต้องส่งรายการมาด้วย', async () => {
    await expect(
      service.bulkSetVisibility({ isOnlineVisible: true, scope: 'SELECTED' }, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.bulkSetVisibility(
        { isOnlineVisible: true, scope: 'SELECTED', productIds: [] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('จำกัดขอบเขตเฉพาะ iPhone ที่อยู่ในสต็อกและยังไม่ถูกลบ', async () => {
    await service.bulkSetVisibility(
      { isOnlineVisible: true, scope: 'SELECTED', productIds: ['x'] },
      OWNER,
    );
    expect(prisma.product.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      brand: 'Apple',
      status: 'IN_STOCK',
      id: { in: ['x'] },
    });
  });

  it('ไม่มีเครื่องเข้าเงื่อนไข → ไม่ยิง updateMany เปล่า ๆ', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    const res = await service.bulkSetVisibility(
      { isOnlineVisible: true, scope: 'ALL_IN_STOCK' },
      OWNER,
    );
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(res).toMatchObject({ matched: 0, changed: 0, willAppear: 0 });
  });

  it('ปิดทั้งหมดก็ทำได้ และรายงานว่าไม่มีอะไรขึ้นเว็บ', async () => {
    prisma.product.findMany.mockResolvedValue([ready({ id: 'a', isOnlineVisible: true })]);
    const res = await service.bulkSetVisibility(
      { isOnlineVisible: false, scope: 'ALL_IN_STOCK' },
      OWNER,
    );
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] } },
      data: { isOnlineVisible: false },
    });
    expect(res.willAppear).toBe(0);
  });
});
