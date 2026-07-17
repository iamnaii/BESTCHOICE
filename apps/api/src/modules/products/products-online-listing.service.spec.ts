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
