import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnlineAppraisalService } from './online-appraisal.service';

const D = (n: number | string) => new Prisma.Decimal(n);

const ONLINE_TRADEIN = {
  id: 'ti-1',
  status: 'PENDING_APPRAISAL',
  appraisalLocked: false,
  firstAppraisedAt: null,
  deviceModel: 'iPhone 15',
  deviceStorage: '128GB',
  estimatedValue: D(12420),
  quoteBreakdown: { maxPrice: '14500.00', price: '12420.00', lines: [] },
  deletedAt: null,
  notes: null,
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
    expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers);
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
});
