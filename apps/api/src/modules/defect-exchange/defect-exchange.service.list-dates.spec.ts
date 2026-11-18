import { DefectExchangeService } from './defect-exchange.service';

/**
 * DefectExchangeService.list — from/to 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม lte = new Date(to) = 07:00 น. ของวันสุดท้าย ⇒ ตัดเกือบทั้งวัน · ไม่ส่ง actor ⇒ ไม่มี context สิทธิ์ (คืนแถว auditLog ตรง ๆ)
 */
describe('DefectExchangeService.list — ขอบวันตามเวลาไทย', () => {
  function make() {
    const prisma = { auditLog: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new DefectExchangeService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it('from/to แบบ YYYY-MM-DD → createdAt [00:00 from, 23:59:59.999 to] เวลาไทย', async () => {
    const { prisma, service } = make();

    await service.list({ from: '2026-11-01', to: '2026-11-17' });

    const createdAt = prisma.auditLog.findMany.mock.calls[0][0].where.createdAt;
    expect(createdAt).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-17T16:59:59.999Z'),
    });
    expect(new Date('2026-11-17T15:00:00+07:00') <= createdAt.lte).toBe(true); // บ่ายของวันสุดท้ายอยู่ในช่วง (เดิมหาย)
    expect(new Date('2026-11-18T00:00:00+07:00') <= createdAt.lte).toBe(false);
  });

  it('to แบบ ISO มีเวลา → ขอบบนตรงตัวเหมือนเดิม', async () => {
    const { prisma, service } = make();

    await service.list({ to: '2026-11-17T05:00:00.000Z' });

    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({
      lte: new Date('2026-11-17T05:00:00.000Z'),
    });
  });

  it('ไม่ส่งวันที่ → ไม่มีตัวกรอง createdAt', async () => {
    const { prisma, service } = make();
    await service.list({});
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
