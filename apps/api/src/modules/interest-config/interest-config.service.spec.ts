import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InterestConfigService } from './interest-config.service';
import { PrismaService } from '../../prisma/prisma.service';

const RATES_INCLUDE = {
  rates: {
    where: { deletedAt: null },
    select: { months: true, ratePct: true },
    orderBy: { months: 'asc' },
  },
};

describe('InterestConfigService', () => {
  let service: InterestConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      interestConfig: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      // #22: vatPct ที่ส่งออก = VAT ของบริษัท FINANCE
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ vatRegistered: true, vatRate: 0.07 }),
      },
      interestConfigRate: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    prisma.$executeRaw = jest.fn().mockResolvedValue(0);
    prisma.$transaction = jest.fn(async (work) => work(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterestConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InterestConfigService>(InterestConfigService);
  });

  describe('findAll', () => {
    it('filters out soft-deleted configs and returns active per-term rows', async () => {
      prisma.interestConfig.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.interestConfig.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: RATES_INCLUDE,
      });
    });
  });

  describe('findOne', () => {
    it('returns a config when found and not soft-deleted', async () => {
      const row = { id: 'cfg-1', name: 'มือ 1', vatPct: '0.1000' };
      prisma.interestConfig.findFirst.mockResolvedValue(row);

      // #22: vatPct ของแถวถูกแทนด้วย VAT ของ FINANCE
      const found = await service.findOne('cfg-1');
      expect(found).toMatchObject({ id: 'cfg-1', name: 'มือ 1' });
      expect(found.vatPct.toString()).toBe('0.07');
      expect(prisma.interestConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'cfg-1', deletedAt: null },
        include: RATES_INCLUDE,
      });
    });

    it('throws NotFoundException when soft-deleted or missing', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);

      await expect(service.findOne('cfg-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCategory', () => {
    it('only returns active, non-deleted configs matching the category', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);

      await service.findByCategory('PHONE');

      expect(prisma.interestConfig.findFirst).toHaveBeenCalledWith({
        where: {
          isActive: true,
          deletedAt: null,
          productCategories: { has: 'PHONE' },
        },
        // B2 Task 4 C2-residual: ต้อง deterministic (oldest-active wins) ให้ตรงกับ
        // resolveConfig + ProductQuoteService.getQuotes — หน้า ContractCreate ใช้เส้นนี้ (id เป็นตัวตัดสินเมื่อ createdAt เท่ากัน)
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  });

  describe('remove', () => {
    it('performs a real soft delete (sets deletedAt) and flips isActive', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue({ id: 'cfg-1' });
      prisma.interestConfig.update.mockResolvedValue({ id: 'cfg-1', deletedAt: new Date() });

      await service.remove('cfg-1');

      const updateCall = prisma.interestConfig.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'cfg-1' });
      expect(updateCall.data.isActive).toBe(false);
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFound when the config does not exist', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);

      await expect(service.remove('cfg-missing')).rejects.toThrow(NotFoundException);
      expect(prisma.interestConfig.update).not.toHaveBeenCalled();
    });
  });

  describe('findByCategory — allowedMonths', () => {
    const config = { id: 'cfg-1', name: 'มือถือใหม่', vatPct: 0.07, minInstallmentMonths: 6, maxInstallmentMonths: 12 };

    it('คืนงวดที่มีแถวรายงวด เรียงน้อยไปมาก', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(config);
      prisma.interestConfigRate.findMany.mockResolvedValue([{ months: 10 }, { months: 12 }]);
      const result = await service.findByCategory('PHONE_NEW');
      expect(result).toMatchObject({ id: 'cfg-1', allowedMonths: [10, 12] });
      expect(prisma.interestConfigRate.findMany).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', deletedAt: null },
        select: { months: true },
        orderBy: { months: 'asc' },
      });
    });

    it('ไม่มีแถวรายงวด → allowedMonths ว่าง', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(config);
      const result = await service.findByCategory('PHONE_NEW');
      expect(result).toMatchObject({ allowedMonths: [] });
    });

    it('ไม่พบตั้งค่าดอกเบี้ยของหมวด → คืนค่าเดิม (null) ไม่อ่านแถวรายงวด', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);
      expect(await service.findByCategory('PHONE_NEW')).toBeNull();
      expect(prisma.interestConfigRate.findMany).not.toHaveBeenCalled();
    });
  });

  describe('ตารางดอกเบี้ยรายงวด (rates)', () => {
    const existing = { id: 'cfg-1', minInstallmentMonths: 6, maxInstallmentMonths: 12, deletedAt: null };

    beforeEach(() => {
      prisma.interestConfig.findFirst.mockResolvedValue(existing);
      prisma.interestConfig.update.mockResolvedValue({ ...existing, vatPct: 0.07 });
    });

    it('ไม่ส่ง rates → ไม่แตะตาราง', async () => {
      await service.update('cfg-1', { name: 'มือ 1' });
      expect(prisma.interestConfigRate.updateMany).not.toHaveBeenCalled();
      expect(prisma.interestConfigRate.upsert).not.toHaveBeenCalled();
    });

    it('ส่ง rates → ลบแถวที่ไม่อยู่ในชุด แล้ว upsert ทุกแถว (ชุบแถวที่เคยลบ)', async () => {
      await service.update('cfg-1', {
        rates: [
          { months: 10, ratePct: 0.5 },
          { months: 12, ratePct: 0.5 },
        ],
      });
      expect(prisma.interestConfigRate.updateMany).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', deletedAt: null, months: { notIn: [10, 12] } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledWith({
        where: { configId_months: { configId: 'cfg-1', months: 12 } },
        update: { ratePct: 0.5, deletedAt: null },
        create: { configId: 'cfg-1', months: 12, ratePct: 0.5 },
      });
    });

    it('ส่ง rates อย่างเดียว → เขียน updatedAt ลงแถว config (ไม่ส่ง = ไม่เขียน)', async () => {
      await service.update('cfg-1', { rates: [{ months: 12, ratePct: 0.5 }] });
      expect(prisma.interestConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { updatedAt: expect.any(Date) },
      });
      prisma.interestConfig.update.mockClear();
      await service.update('cfg-1', { name: 'มือ 1' });
      expect(prisma.interestConfig.update.mock.calls[0][0].data).toEqual({ name: 'มือ 1' });
    });

    it('rates: [] → ลบทุกแถว', async () => {
      await service.update('cfg-1', { rates: [] });
      expect(prisma.interestConfigRate.updateMany).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', deletedAt: null, months: { notIn: [] } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.interestConfigRate.upsert).not.toHaveBeenCalled();
    });

    it('งวดซ้ำในชุด → ปฏิเสธ ไม่เขียนอะไร', async () => {
      await expect(
        service.update('cfg-1', { rates: [{ months: 12, ratePct: 0.5 }, { months: 12, ratePct: 0.4 }] }),
      ).rejects.toThrow('จำนวนงวดซ้ำกันในตารางรายงวด: 12 งวด');
      expect(prisma.interestConfigRate.upsert).not.toHaveBeenCalled();
    });

    it('งวดนอกช่วงต่ำสุด–สูงสุด → ปฏิเสธ', async () => {
      await expect(service.update('cfg-1', { rates: [{ months: 15, ratePct: 0.6 }] })).rejects.toThrow(
        'ตารางรายงวดมี 15 งวด ซึ่งอยู่นอกช่วงงวดต่ำสุด–สูงสุด (6–12 งวด)',
      );
    });

    it('ใช้ช่วงงวดใหม่ที่ส่งมาพร้อมกันในการตรวจ', async () => {
      await service.update('cfg-1', { maxInstallmentMonths: 15, rates: [{ months: 15, ratePct: 0.6 }] });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledTimes(1);
    });

    it('แก้ช่วงงวดจนแถวเดิมหลุดช่วง (ไม่ได้ส่ง rates) → ปฏิเสธ', async () => {
      prisma.interestConfigRate.findMany.mockResolvedValue([{ months: 10 }, { months: 12 }]);
      await expect(service.update('cfg-1', { maxInstallmentMonths: 10 })).rejects.toThrow(
        'ตารางรายงวดมี 12 งวด ซึ่งอยู่นอกช่วงงวดต่ำสุด–สูงสุด (6–10 งวด) — แก้ตารางรายงวดก่อน',
      );
    });

    it('create พร้อม rates → เขียนตารางให้ config ใหม่', async () => {
      prisma.interestConfig.create.mockResolvedValue({ id: 'cfg-new', vatPct: 0.07 });
      await service.create({
        name: 'มือ 2',
        productCategories: ['PHONE_USED'],
        interestRate: 0.05,
        minDownPaymentPct: 0.15,
        minInstallmentMonths: 6,
        maxInstallmentMonths: 12,
        rates: [{ months: 10, ratePct: 0.5 }],
      });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledWith({
        where: { configId_months: { configId: 'cfg-new', months: 10 } },
        update: { ratePct: 0.5, deletedAt: null },
        create: { configId: 'cfg-new', months: 10, ratePct: 0.5 },
      });
    });
  });
  describe('กันดอกเบี้ย 0% — ต่อเดือน 0 และไม่มีแถวรายงวด', () => {
    const MSG = 'ต้องมีดอกเบี้ยต่อเดือนมากกว่า 0 หรือมีตารางดอกเบี้ยรายงวดอย่างน้อย 1 แถว';
    const stored = (interestRate: unknown) => ({
      id: 'cfg-1',
      interestRate,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      deletedAt: null,
    });
    const createDto = (over: Record<string, unknown> = {}) => ({
      name: 'มือ 2',
      productCategories: ['PHONE_USED'],
      interestRate: 0,
      minDownPaymentPct: 0.15,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      ...over,
    });

    beforeEach(() => {
      prisma.interestConfig.update.mockResolvedValue({ id: 'cfg-1', vatPct: 0.07 });
      prisma.interestConfig.create.mockResolvedValue({ id: 'cfg-new', vatPct: 0.07 });
    });

    it('update: เก็บต่อเดือน 0 แล้วส่ง rates: [] → ปฏิเสธ ไม่เขียน', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(0));
      await expect(service.update('cfg-1', { rates: [] })).rejects.toThrow(MSG);
      expect(prisma.interestConfigRate.updateMany).not.toHaveBeenCalled();
      expect(prisma.interestConfig.update).not.toHaveBeenCalled();
    });

    it('update: ส่ง interestRate 0 (ไม่ส่ง rates) ขณะไม่มีแถวใช้งาน → ปฏิเสธ', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(0.05));
      prisma.interestConfigRate.findMany.mockResolvedValue([]);
      await expect(service.update('cfg-1', { interestRate: 0 })).rejects.toThrow(MSG);
      expect(prisma.interestConfig.update).not.toHaveBeenCalled();
    });

    it('update: interestRate 0 + rates: [] → ปฏิเสธ', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(0.05));
      await expect(service.update('cfg-1', { interestRate: 0, rates: [] })).rejects.toThrow(MSG);
      expect(prisma.interestConfig.update).not.toHaveBeenCalled();
    });

    it('update: ต่อเดือน 0 + ไม่ส่ง rates + มีแถวใช้งาน → ผ่าน', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(0.05));
      prisma.interestConfigRate.findMany.mockResolvedValue([{ months: 12 }]);
      await service.update('cfg-1', { interestRate: 0 });
      expect(prisma.interestConfig.update).toHaveBeenCalled();
    });

    it('update: ต่อเดือน 0 + ส่ง rates ≥ 1 แถว → ผ่าน', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(0.05));
      await service.update('cfg-1', { interestRate: 0, rates: [{ months: 12, ratePct: 0.5 }] });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledTimes(1);
    });

    it('update: ต่อเดือน > 0 + rates: [] → ผ่าน', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(0.05));
      await service.update('cfg-1', { rates: [] });
      expect(prisma.interestConfig.update).toHaveBeenCalled();
    });

    it('update: เก็บค่าเป็น Decimal 0 ก็ถือว่า 0', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(stored(new Prisma.Decimal(0)));
      await expect(service.update('cfg-1', { rates: [] })).rejects.toThrow(MSG);
    });

    it('create: ต่อเดือน 0 ไม่ส่ง rates → ปฏิเสธ ไม่เขียน', async () => {
      await expect(service.create(createDto())).rejects.toThrow(MSG);
      expect(prisma.interestConfig.create).not.toHaveBeenCalled();
    });

    it('create: ต่อเดือน 0 + rates: [] → ปฏิเสธ', async () => {
      await expect(service.create(createDto({ rates: [] }))).rejects.toThrow(MSG);
      expect(prisma.interestConfig.create).not.toHaveBeenCalled();
    });

    it('create: ต่อเดือน 0 + rates ≥ 1 แถว → ผ่าน', async () => {
      await service.create(createDto({ rates: [{ months: 12, ratePct: 0.5 }] }));
      expect(prisma.interestConfig.create).toHaveBeenCalled();
    });
  });
});
