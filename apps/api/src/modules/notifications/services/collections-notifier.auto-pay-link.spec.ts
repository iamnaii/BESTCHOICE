import * as Sentry from '@sentry/nestjs';
import { CollectionsNotifierService } from './collections-notifier.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 30 รอบ 2 ข้อ 1 — T-3 เหลือการ์ดลิงก์ชำระ (A6 `sendAutoPaymentLinks` 08:30) ใบเดียว: A6 ค้นงวดด้วยเงื่อนไขเดียวกับที่ A1 ใช้เว้นให้
 * (`autoPayLinkPaymentWhere`) · ไม่ส่งซ้ำงวดที่ได้ข้อความเตือนวันนี้แล้ว (บอทสั่งรันก่อน / สั่งรัน A6 ซ้ำ) · ส่งแล้วลงแถว SENT หมวด REMINDER
 * (ให้บอท 09:00 / A1 ที่สั่งรันซ้ำเห็น) · ส่งไม่ผ่านลงแถว FAILED (A1 ที่สั่งรันซ้ำส่งแทน · บอท 09:00 ส่งแทนอยู่แล้ว)
 */
describe('CollectionsNotifierService.sendAutoPaymentLinks — การ์ดลิงก์ชำระ T-3', () => {
  const NOW = new Date('2026-12-01T01:30:00Z'); // 08:30 น. ไทย
  const payment = {
    id: 'pay-1',
    contractId: 'k1',
    installmentNo: 4,
    dueDate: new Date('2026-12-04T00:00:00Z'),
    amountDue: 1515.83,
    amountPaid: 0,
    lateFee: 0,
    contract: {
      contractNumber: 'CT-1',
      totalMonths: 12,
      customer: { id: 'cust-1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U-1' }] },
    },
  };

  function build(opts: { sentToday?: boolean; linkFails?: boolean; dunnedToday?: boolean } = {}) {
    const prisma = {
      payment: { findMany: jest.fn().mockResolvedValue([payment]) },
      notificationLog: {
        findFirst: jest.fn().mockResolvedValue(opts.sentToday ? { id: 'already' } : null),
        // รอบ 5 — ข้อความทวงระดับสัญญาวันนี้ (`findContractsDunnedToday`)
        findMany: jest.fn().mockResolvedValue(opts.dunnedToday ? [{ relatedId: 'k1' }] : []),
        create: jest.fn().mockResolvedValue({ id: 'log' }),
      },
      chatAutoTrigger: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    const links = {
      createPaymentLink: opts.linkFails
        ? jest.fn().mockRejectedValue(new Error('gateway down'))
        : jest.fn().mockResolvedValue({ url: 'https://pay.test/abc', token: 't', amount: 1515.83 }),
    };
    const service = new CollectionsNotifierService(
      prisma as never,
      lineOa as never,
      {} as never,
      {} as never,
      links as never,
    );
    return { prisma, lineOa, links, service };
  }

  it('ค้นงวดด้วยเงื่อนไขของลิงก์ชำระอัตโนมัติ (ครบกำหนดอีก 3 วันตามวันไทย · PENDING · สัญญา ACTIVE · ผูก LINE การเงิน)', async () => {
    const { prisma, service } = build();

    await service.sendAutoPaymentLinks(NOW);

    const where = prisma.payment.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING');
    expect(where.dueDate).toEqual({
      gte: new Date('2026-12-03T17:00:00Z'),
      lt: new Date('2026-12-04T17:00:00Z'),
    });
    expect(where.contract.status).toEqual({ in: ['ACTIVE'] });
  });

  it('ส่งการ์ดแล้วลงแถว SENT หมวด REMINDER ของงวด (ไม่เก็บ URL ลิงก์ในแถว)', async () => {
    const { prisma, lineOa, service } = build();

    await service.sendAutoPaymentLinks(NOW);

    expect(lineOa.sendFlexMessage).toHaveBeenCalledWith('U-1', expect.anything(), 'line-finance');
    const data = prisma.notificationLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'U-1',
      subject: 'ลิงก์ชำระอัตโนมัติ',
      status: 'SENT',
      category: 'REMINDER',
      relatedId: 'pay-1',
      customerId: 'cust-1',
    });
    expect(data.message).not.toContain('https://');
  });

  it('งวดที่ได้ข้อความเตือนวันนี้แล้ว (บอทสั่งรันก่อน / สั่งรันซ้ำ) → ไม่สร้างลิงก์ ไม่ส่ง', async () => {
    const { links, lineOa, service } = build({ sentToday: true });

    await service.sendAutoPaymentLinks(NOW);

    expect(links.createPaymentLink).not.toHaveBeenCalled();
    expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
  });

  it('รอบ 5 (เจ้าของ 01/11 ข้อ 1) — สัญญาได้ข้อความทวงแล้ววันนี้ → ไม่ส่งการ์ดเตือนค่างวด ไม่สร้างลิงก์', async () => {
    const { prisma, links, lineOa, service } = build({ dunnedToday: true });

    await service.sendAutoPaymentLinks(NOW);

    expect(links.createPaymentLink).not.toHaveBeenCalled();
    expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    expect(prisma.notificationLog.findMany.mock.calls[0][0].where.relatedId).toEqual({
      in: ['k1'],
    });
  });

  it('สร้างลิงก์/ส่งไม่ผ่าน → แถว FAILED (ให้ A1 ที่สั่งรันซ้ำส่งแทน)', async () => {
    const { prisma, lineOa, service } = build({ linkFails: true });

    await service.sendAutoPaymentLinks(NOW);

    expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create.mock.calls[0][0].data).toMatchObject({
      subject: 'ลิงก์ชำระอัตโนมัติ',
      status: 'FAILED',
      relatedId: 'pay-1',
      errorMsg: 'gateway down',
    });
  });

  it('รอบ 3 M3 — การ์ดถึงแล้วแต่ลงแถว SENT ไม่ได้ → ลองลงใหม่ · ยังไม่ได้ = Sentry warning (ไม่มี PII)', async () => {
    const { prisma, lineOa, service } = build();
    prisma.notificationLog.create.mockRejectedValue(new Error('db down'));

    await service.sendAutoPaymentLinks(NOW);

    expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(2);
    const [, context] = (Sentry.captureMessage as jest.Mock).mock.calls.at(-1)!;
    expect(context.extra).toMatchObject({ relatedId: 'pay-1', status: 'SENT' });
    expect(JSON.stringify(context)).not.toContain('U-1');
  });
});
