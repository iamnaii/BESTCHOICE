import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnlineAppraisalService } from './online-appraisal.service';

const D = (n: number | string) => new Prisma.Decimal(n);

const ONLINE_TRADEIN = {
  id: 'ti-1',
  status: 'PENDING_APPRAISAL',
  appraisalLocked: false,
  firstAppraisedAt: null,
  flow: 'BUYBACK',
  deviceModel: 'iPhone 15',
  deviceStorage: '128GB',
  estimatedValue: D(12420),
  quoteBreakdown: { maxPrice: '14500.00', price: '12420.00', lines: [] },
  deletedAt: null,
  notes: null,
};

const EXCHANGE_TRADEIN = {
  ...ONLINE_TRADEIN,
  flow: 'EXCHANGE',
  estimatedValue: D(13660),
  quoteBreakdown: {
    maxPrice: '14500.00', price: '13660.00', cashPrice: '12420.00',
    exchangePrice: '13660.00', bonusPct: '10', chosenFlow: 'EXCHANGE', lines: [],
  },
};

describe('OnlineAppraisalService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopBuyback: any;
  let service: OnlineAppraisalService;

  beforeEach(() => {
    prisma = {
      tradeIn: {
        findFirst: jest.fn().mockResolvedValue({ ...ONLINE_TRADEIN }),
        // CAS write: updateMany with a conditional WHERE (count===0 → race loser),
        // followed by a findUnique re-read to return the fresh record.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ ...ONLINE_TRADEIN }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    shopBuyback = { quoteForAnswers: jest.fn() };
    service = new OnlineAppraisalService(prisma, shopBuyback);
  });

  it('AS_ANSWERED: offeredPrice = estimatedValue เป๊ะ + snapshot maxPrice + lock', async () => {
    await service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('12420');
    expect(data.status).toBe('APPRAISED');
    expect(data.appraisalLocked).toBe(true);
    expect(data.basePriceAtAppraisal.toString()).toBe('14500');
    expect(data.appraisedById).toBe('u1');
  });

  it('REVISED: คิดราคาใหม่จาก engine + อัปเดต snapshot + เกรดใหม่', async () => {
    shopBuyback.quoteForAnswers.mockResolvedValue({
      available: true,
      price: '9100.00',
      maxPrice: '14500.00',
      grade: 'C',
      breakdown: { maxPrice: '14500.00', price: '9100.00', lines: [] },
      conditionAnswers: [{ questionKey: 'x' }],
    });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER');
    expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers, 'BUYBACK');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('9100');
    expect(data.deviceCondition).toBe('C');
    expect(data.estimatedValue.toString()).toBe('9100');
    expect(data.quoteBreakdown.price).toBe('9100.00');
  });

  it('REVISED โดยไม่ส่ง answers → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'REVISED' }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('MANUAL: ต้องเป็น OWNER + reason — เขียน audit log', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'จอมีตำหนิเพิ่ม' }, 'u1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(ForbiddenException);

    await service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'จอมีตำหนิเพิ่ม' }, 'u1', 'OWNER');
    expect(prisma.auditLog.create).toHaveBeenCalled();
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('TRADE_IN_ONLINE_MANUAL_PRICE');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('5000');
  });

  it('MANUAL ไม่มี reason → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000 }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('record ไม่มี quoteBreakdown → BadRequestException (ให้ใช้ appraise เดิม)', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, quoteBreakdown: null });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ล็อคแล้ว → เฉพาะ MANUAL+OWNER เท่านั้น', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, appraisalLocked: true, firstAppraisedAt: new Date('2026-07-01') });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(ForbiddenException);
    await service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'ตกลงราคาใหม่' }, 'u1', 'OWNER');
    expect(prisma.tradeIn.updateMany).toHaveBeenCalled();
  });

  it('AS_ANSWERED: updateMany count=0 (ถูกอีกคนประเมินไปแล้วระหว่างอ่าน) → BadRequestException (race loser)', async () => {
    prisma.tradeIn.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('MANUAL บน record ที่จบ lifecycle แล้ว (status ACCEPTED, locked) → BadRequestException, ไม่แตะ updateMany', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({
      ...ONLINE_TRADEIN,
      status: 'ACCEPTED',
      appraisalLocked: true,
      firstAppraisedAt: new Date('2026-07-01'),
    });
    await expect(
      service.appraiseOnline(
        'ti-1',
        { mode: 'MANUAL', offeredPrice: 5000, reason: 'พยายามแก้ราคาย้อนหลัง' },
        'u1',
        'OWNER',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
  });

  it('REVISED: basePriceAtAppraisal snapshot จาก breakdown "ใหม่" ที่เพิ่งคิด ไม่ใช่ breakdown เก่าของ record', async () => {
    // record เดิม quoteBreakdown.maxPrice = '14500.00' — engine คิดใหม่ได้ราคาฐานต่างออกไป
    shopBuyback.quoteForAnswers.mockResolvedValue({
      available: true,
      price: '9100.00',
      maxPrice: '15000.00',
      grade: 'C',
      breakdown: { maxPrice: '15000.00', price: '9100.00', lines: [] },
      conditionAnswers: [{ questionKey: 'x' }],
    });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.basePriceAtAppraisal.toString()).toBe('15000');
  });

  it('MANUAL race-loser: สอง OWNER เรียก MANUAL พร้อมกันบน record APPRAISED เดิม → updateMany count=0 → BadRequestException, WHERE ล็อคด้วย offeredPrice ที่อ่านมา', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({
      ...ONLINE_TRADEIN,
      status: 'APPRAISED',
      appraisalLocked: true,
      firstAppraisedAt: new Date('2026-07-01'),
      offeredPrice: D(5000),
    });
    prisma.tradeIn.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.appraiseOnline(
        'ti-1',
        { mode: 'MANUAL', offeredPrice: 6000, reason: 'แก้ราคาซ้ำ (ผู้ใช้อื่นแก้ไปแล้ว)' },
        'u1',
        'OWNER',
      ),
    ).rejects.toThrow(BadRequestException);
    const where = prisma.tradeIn.updateMany.mock.calls[0][0].where;
    expect(where.offeredPrice.toString()).toBe('5000');
  });

  describe('flow-aware (spec /sell §7.2)', () => {
    it('REVISED บน EXCHANGE: ส่ง flow เข้า engine + ราคา/chosenFlow ตาม flow', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
      shopBuyback.quoteForAnswers.mockResolvedValue({
        available: true, price: '9990.00', maxPrice: '14500.00', grade: 'C',
        breakdown: { maxPrice: '14500.00', price: '9990.00', cashPrice: '9080.00',
          exchangePrice: '9990.00', bonusPct: '10', chosenFlow: 'EXCHANGE', lines: [] },
        conditionAnswers: [],
      });
      const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
      await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER');
      expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers, 'EXCHANGE');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.offeredPrice.toString()).toBe('9990');
      expect(data.estimatedValue.toString()).toBe('9990');
      expect(data.quoteBreakdown.chosenFlow).toBe('EXCHANGE');
    });

    it('AS_ANSWERED useCashPrice บน EXCHANGE: ราคา cash + flip flow → BUYBACK + invariant breakdown', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
      await service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED', useCashPrice: true }, 'u1', 'BRANCH_MANAGER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.offeredPrice.toString()).toBe('12420');
      expect(data.flow).toBe('BUYBACK');
      expect(data.estimatedValue.toString()).toBe('12420');
      expect(data.quoteBreakdown.price).toBe('12420.00');
      expect(data.quoteBreakdown.chosenFlow).toBe('BUYBACK');
    });

    it('useCashPrice บน record BUYBACK → BadRequestException', async () => {
      await expect(
        service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED', useCashPrice: true }, 'u1', 'OWNER'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
