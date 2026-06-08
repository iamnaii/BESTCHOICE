import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopTradeInService } from './shop-trade-in.service';
import { TradeInIntakeService } from './trade-in-intake.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';

/**
 * Characterization tests — ShopTradeInService had ZERO coverage. Locks the
 * trade-in margin (0.85/1.05), the EXCHANGE intake flow + target productId,
 * dedup/valuation guards, non-fatal LINE flex, and getStatus — before the
 * shared TradeInIntakeService extraction (Wave-4 fold of shop-buyback ≈
 * shop-trade-in).
 */
describe('ShopTradeInService', () => {
  let service: ShopTradeInService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let line: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valuation = (over: any = {}) => ({ basePrice: 10000, deletedAt: null, ...over });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dto = (over: any = {}): any => ({
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128',
    condition: 'A',
    batteryHealth: 90,
    imei: '111',
    photoUrls: ['u'],
    notes: 'n',
    lineUserId: 'L1',
    sellerName: 'S',
    sellerPhone: '0800000000',
    targetProductId: 'prod-9',
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      tradeInValuation: { findUnique: jest.fn().mockResolvedValue(valuation()) },
      tradeIn: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ti-1', status: 'PENDING_APPRAISAL' }),
        findUnique: jest.fn(),
      },
    };
    line = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ShopTradeInService,
        TradeInIntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineOaService, useValue: line },
      ],
    }).compile();
    service = mod.get(ShopTradeInService);
  });

  describe('estimate', () => {
    it('applies the trade-in margin floor(base*0.85) / ceil(base*1.05)', async () => {
      const r = await service.estimate(dto());
      expect(r).toEqual({ min: 8500, max: 10500, available: true, basePrice: 10000 });
    });

    it('returns unavailable when no valuation row exists', async () => {
      prisma.tradeInValuation.findUnique.mockResolvedValue(null);
      const r = await service.estimate(dto());
      expect(r).toEqual({ min: 0, max: 0, available: false });
    });
  });

  describe('submit', () => {
    it('creates a TradeIn with flow=EXCHANGE + target productId and returns id/status/etaHours', async () => {
      const r = await service.submit(dto(), 'cust-1');
      expect(prisma.tradeIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flow: 'EXCHANGE',
            status: 'PENDING_APPRAISAL',
            basePriceAtAppraisal: 10000,
            customerId: 'cust-1',
            productId: 'prod-9',
          }),
        }),
      );
      expect(r).toEqual({ id: 'ti-1', status: 'PENDING_APPRAISAL', etaHours: 24 });
    });

    it('rejects a duplicate (same imei+phone within 24h)', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.submit(dto(), 'c')).rejects.toThrow(BadRequestException);
      expect(prisma.tradeIn.create).not.toHaveBeenCalled();
    });

    it('throws when no valuation exists for the model', async () => {
      prisma.tradeInValuation.findUnique.mockResolvedValue(null);
      await expect(service.submit(dto(), 'c')).rejects.toThrow(NotFoundException);
    });

    it('still succeeds when the LINE flex notification fails (non-fatal)', async () => {
      line.sendFlexMessage.mockRejectedValue(new Error('LINE down'));
      const r = await service.submit(dto(), 'c');
      expect(r.id).toBe('ti-1');
    });
  });

  describe('getStatus', () => {
    it('returns the record when found', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue({
        id: 'ti-1',
        status: 'PENDING_APPRAISAL',
        flow: 'EXCHANGE',
      });
      const r = await service.getStatus('ti-1');
      expect(r.id).toBe('ti-1');
    });

    it('throws NotFoundException when missing', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('x')).rejects.toThrow(NotFoundException);
    });
  });
});
