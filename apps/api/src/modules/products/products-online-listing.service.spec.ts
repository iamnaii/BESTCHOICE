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

    // Regression (review finding CRITICAL): the visible⇒has-photo invariant
    // must hold even when THIS request doesn't touch isOnlineVisible at all —
    // clearing gallery on an already-visible product must not silently leave
    // it visible with an empty gallery.
    it('rejects PATCH { gallery: [] } on a product that is already visible', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, isOnlineVisible: true });
      await expect(service.updateOnlineListing('p1', { gallery: [] })).rejects.toThrow(/รูป/);
      expect(prisma.product.update).not.toHaveBeenCalled();
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
