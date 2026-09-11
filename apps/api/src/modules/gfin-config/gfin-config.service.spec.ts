import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GfinConfigService } from './gfin-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('GfinConfigService', () => {
  let service: GfinConfigService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    prisma = {
      gfinModelMapping: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      gfinOverpriceRule: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      gfinRateFactor: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
      },
      systemConfig: {
        // config.util.readRawValue อ่านด้วย findFirst({ where: { key, deletedAt: null } })
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    audit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GfinConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(GfinConfigService);
  });

  // ===== Max Prices =====

  describe('createMaxPrice', () => {
    it('creates row and writes audit log', async () => {
      const created = {
        id: 'm1',
        gfinSeries: 'iPhone 14',
        gfinVariant: 'Pro',
        storage: '128GB',
        condition: 'HAND_2',
        maxPrice: new Prisma.Decimal('21500'),
        modelMatchPattern: 'iPhone 14 Pro',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.gfinModelMapping.create.mockResolvedValue(created);

      const result = await service.createMaxPrice(
        {
          gfinSeries: 'iPhone 14',
          gfinVariant: 'Pro',
          storage: '128GB',
          condition: 'HAND_2' as any,
          maxPrice: 21500,
          modelMatchPattern: 'iPhone 14 Pro',
        },
        'user-1',
      );

      expect(prisma.gfinModelMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gfinSeries: 'iPhone 14',
            maxPrice: expect.any(Prisma.Decimal),
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GFIN_MAX_PRICE_CREATED',
          entity: 'gfin_model_mapping',
          entityId: 'm1',
          userId: 'user-1',
        }),
      );
      expect(result.id).toBe('m1');
    });
  });

  describe('updateMaxPrice', () => {
    it('throws NotFoundException when row missing', async () => {
      prisma.gfinModelMapping.findUnique.mockResolvedValue(null);
      await expect(service.updateMaxPrice('nope', {} as any, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when row is soft-deleted', async () => {
      prisma.gfinModelMapping.findUnique.mockResolvedValue({
        id: 'm1',
        deletedAt: new Date(),
      });
      await expect(service.updateMaxPrice('m1', {} as any, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('writes audit log with both oldValue and newValue', async () => {
      const existing = {
        id: 'm1',
        maxPrice: new Prisma.Decimal('20000'),
        deletedAt: null,
      };
      const updated = { id: 'm1', maxPrice: new Prisma.Decimal('21500') };
      prisma.gfinModelMapping.findUnique.mockResolvedValue(existing);
      prisma.gfinModelMapping.update.mockResolvedValue(updated);

      await service.updateMaxPrice('m1', { maxPrice: 21500 } as any, 'user-2');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GFIN_MAX_PRICE_UPDATED',
          entity: 'gfin_model_mapping',
          entityId: 'm1',
          userId: 'user-2',
          oldValue: expect.objectContaining({ id: 'm1' }),
          newValue: expect.objectContaining({ id: 'm1' }),
        }),
      );
    });
  });

  describe('softDeleteMaxPrice', () => {
    it('soft-deletes and logs', async () => {
      const existing = { id: 'm1', deletedAt: null };
      const softDeleted = { id: 'm1', deletedAt: new Date() };
      prisma.gfinModelMapping.findUnique.mockResolvedValue(existing);
      prisma.gfinModelMapping.update.mockResolvedValue(softDeleted);

      await service.softDeleteMaxPrice('m1', 'user-1');

      expect(prisma.gfinModelMapping.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GFIN_MAX_PRICE_DELETED' }),
      );
    });

    it('throws NotFoundException if row not found', async () => {
      prisma.gfinModelMapping.findUnique.mockResolvedValue(null);
      await expect(service.softDeleteMaxPrice('nope', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ===== Overprice Rules =====

  describe('createOverpriceRule', () => {
    it('creates row and writes audit log', async () => {
      const created = {
        id: 'r1',
        label: 'iPhone 14 Series',
        seriesPattern: 'iPhone 14|iPhone 14 Pro',
        condition: 'HAND_2',
        allowance: new Prisma.Decimal('500'),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.gfinOverpriceRule.create.mockResolvedValue(created);

      await service.createOverpriceRule(
        {
          label: 'iPhone 14 Series',
          seriesPattern: 'iPhone 14|iPhone 14 Pro',
          condition: 'HAND_2' as any,
          allowance: 500,
        },
        'user-1',
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GFIN_OVERPRICE_RULE_CREATED',
          entity: 'gfin_overprice_rule',
          entityId: 'r1',
          userId: 'user-1',
        }),
      );
    });
  });

  describe('softDeleteOverpriceRule', () => {
    it('soft-deletes and logs', async () => {
      const existing = { id: 'r1', deletedAt: null };
      prisma.gfinOverpriceRule.findUnique.mockResolvedValue(existing);
      prisma.gfinOverpriceRule.update.mockResolvedValue({ id: 'r1', deletedAt: new Date() });

      await service.softDeleteOverpriceRule('r1', 'user-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GFIN_OVERPRICE_RULE_DELETED' }),
      );
    });
  });

  // ===== Rate Factors =====

  describe('createRateFactor', () => {
    it('creates row and writes audit log', async () => {
      const created = {
        id: 'f1',
        months: 10,
        factor: new Prisma.Decimal('0.020000'),
        feePerInstallment: new Prisma.Decimal('100'),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.gfinRateFactor.create.mockResolvedValue(created);

      await service.createRateFactor({ months: 10, factor: 0.02 }, 'user-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GFIN_RATE_FACTOR_CREATED',
          entity: 'gfin_rate_factor',
          entityId: 'f1',
          userId: 'user-1',
        }),
      );
    });
  });

  describe('softDeleteRateFactor', () => {
    it('soft-deletes and logs', async () => {
      const existing = { id: 'f1', deletedAt: null };
      prisma.gfinRateFactor.findUnique.mockResolvedValue(existing);
      prisma.gfinRateFactor.update.mockResolvedValue({ id: 'f1', deletedAt: new Date() });

      await service.softDeleteRateFactor('f1', 'user-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GFIN_RATE_FACTOR_DELETED' }),
      );
    });
  });

  // ===== 2026-09-11: เรทต่อ (งวด, %คอม) + ผ่อนสูงสุดต่อกฎ OVER =====

  describe('createRateFactor — shopCommissionPct', () => {
    it('ส่ง shopCommissionPct ไป Prisma และ default 15 เมื่อไม่ระบุ', async () => {
      prisma.gfinRateFactor.create.mockResolvedValue({ id: 'f2' });

      await service.createRateFactor(
        { months: 12, factor: 0.179238, shopCommissionPct: 5 },
        'user-1',
      );
      expect(prisma.gfinRateFactor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ months: 12, shopCommissionPct: 5 }),
        }),
      );

      await service.createRateFactor({ months: 12, factor: 0.179238 }, 'user-1');
      expect(prisma.gfinRateFactor.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ shopCommissionPct: 15 }) }),
      );
    });

    it('updateRateFactor แก้ shopCommissionPct ได้', async () => {
      prisma.gfinRateFactor.findUnique.mockResolvedValue({ id: 'f1', deletedAt: null });
      prisma.gfinRateFactor.update.mockResolvedValue({ id: 'f1' });

      await service.updateRateFactor('f1', { shopCommissionPct: 5 }, 'user-1');

      expect(prisma.gfinRateFactor.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { shopCommissionPct: 5 },
      });
    });
  });

  describe('overprice rule — maxMonths', () => {
    it('createOverpriceRule ส่ง maxMonths', async () => {
      prisma.gfinOverpriceRule.create.mockResolvedValue({ id: 'r9' });

      await service.createOverpriceRule(
        {
          label: 'iPhone 16 มือ 1',
          seriesPattern: 'iPhone 16',
          condition: 'HAND_1',
          allowance: 2000,
          maxMonths: 15,
        },
        'user-1',
      );

      expect(prisma.gfinOverpriceRule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ maxMonths: 15 }) }),
      );
    });

    it('updateOverpriceRule ล้าง maxMonths เป็น null ได้', async () => {
      prisma.gfinOverpriceRule.findUnique.mockResolvedValue({ id: 'r1', deletedAt: null });
      prisma.gfinOverpriceRule.update.mockResolvedValue({ id: 'r1' });

      await service.updateOverpriceRule('r1', { maxMonths: null }, 'user-1');

      expect(prisma.gfinOverpriceRule.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { maxMonths: null },
      });
    });
  });

  // ===== ค่าตั้งค่า GFIN (system_config gfin.*) =====

  describe('gfin settings', () => {
    it('คืนค่า default เมื่อไม่มี key ใน system_config', async () => {
      const s = await service.getSettings();
      expect(s).toEqual({
        minDownPct: 25,
        maxDownPct: 80,
        downStepPct: 5,
        contractFee: 100,
        commissionPctByCategory: { PHONE: 15, TABLET: 5 },
      });
    });

    it('อ่านค่าจาก system_config รายคีย์', async () => {
      const values: Record<string, string> = {
        'gfin.minDownPct': '30',
        'gfin.commissionPct.TABLET': '7',
        'gfin.contractFee': '150',
      };
      prisma.systemConfig.findFirst.mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve(values[where.key] ? { value: values[where.key] } : null),
      );

      const s = await service.getSettings();

      expect(s.minDownPct).toBe(30);
      expect(s.contractFee).toBe(150);
      expect(s.commissionPctByCategory).toEqual({ PHONE: 15, TABLET: 7 });
    });

    it('updateSettings upsert เฉพาะคีย์ที่ส่งมา + audit', async () => {
      await service.updateSettings({ minDownPct: 35, commissionPhone: 10 }, 'user-1');

      expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'gfin.minDownPct' },
          create: expect.objectContaining({ key: 'gfin.minDownPct', value: '35' }),
          update: expect.objectContaining({ value: '35' }),
        }),
      );
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'gfin.commissionPct.PHONE' } }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GFIN_SETTINGS_UPDATED', userId: 'user-1' }),
      );
    });
  });

  // ===== Match Preview =====

  describe('matchPreview', () => {
    it('throws NotFoundException when product not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.matchPreview('no-product')).rejects.toThrow(NotFoundException);
    });

    it('returns match result for a product that matches a mapping', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'iPhone 14 Pro 128GB',
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        category: 'PHONE_USED',
      });
      prisma.gfinModelMapping.findMany.mockResolvedValue([
        {
          id: 'm1',
          gfinSeries: 'iPhone 14',
          gfinVariant: 'Pro',
          storage: '128GB',
          condition: 'HAND_2',
          maxPrice: new Prisma.Decimal('21500'),
          modelMatchPattern: 'iPhone 14 Pro',
          isActive: true,
        },
      ]);

      const result = await service.matchPreview('p1');

      expect(result.product.id).toBe('p1');
      expect(result.match).not.toBeNull();
      expect(result.match?.id).toBe('m1');
    });

    it('returns null match when no mapping found', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p2',
        name: 'Samsung Galaxy A54',
        brand: 'Samsung',
        model: 'Galaxy A54',
        storage: '128GB',
        category: 'PHONE_NEW',
      });
      prisma.gfinModelMapping.findMany.mockResolvedValue([]);

      const result = await service.matchPreview('p2');
      expect(result.match).toBeNull();
    });
  });
});
