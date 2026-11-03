import * as Sentry from '@sentry/nestjs';
import { NotificationDispatchService } from './notification-dispatch.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 30 รอบ 4 m3 (รีวิวรอบ 3) — ทาง Flex ของ `sendFromTemplate` (ขั้นทวง A4 · แจ้งล็อก · แม่แบบ Flex ทุกตัว): push ถึงลูกค้าแล้วแต่ลงแถว
 * `notification_logs` ไม่ได้ ⇒ **ต้องไม่ตกไปทางข้อความ** (เดิม push + log อยู่ใน try เดียว — log พัง = ส่งข้อความที่สอง) · แบบเดียวกับ A1/A2 (รอบ 3 M3)
 */
describe('NotificationDispatchService.sendFromTemplate (Flex) — แยก push กับลง log', () => {
  function build(create: jest.Mock, push = jest.fn().mockResolvedValue(undefined)) {
    const prisma = {
      chatRoom: { findFirst: jest.fn().mockResolvedValue(null) },
      chatMessage: { create: jest.fn() },
      notificationLog: { create },
      // ช่วงผ่อนผันหลังผูก LINE — ไม่มีสัญญานำเข้า
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const transport = {
      sendLineFlexMessage: push,
      sendLine: jest.fn().mockResolvedValue(undefined),
    };
    const templates = {
      findByEventType: jest.fn().mockResolvedValue({
        isActive: true,
        format: 'flex',
        channel: 'LINE',
        channelKey: 'line-finance',
        flexTemplate: JSON.stringify({ type: 'bubble' }),
        messageTemplate: 'ค้าง {amount}',
        name: 'tpl',
        subject: 'แจ้งเตือนล็อคเครื่อง',
        category: 'DUNNING',
      }),
    };
    const compliance = {
      canSend: jest.fn().mockResolvedValue({ allowed: true }),
      ensureIdentificationPrefix: (message: string) => message,
      scanForbiddenContent: () => [],
    };
    const service = new NotificationDispatchService(
      transport as never,
      prisma as never,
      compliance as never,
      templates as never,
    );
    return { service, transport, prisma };
  }

  beforeEach(() => jest.clearAllMocks());

  it('ลง log พังครั้งแรก → ลองลงใหม่ · ไม่ส่งทางข้อความ · คืน SENT พร้อม id ของแถว', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('db down'), { code: 'P1001' }))
      .mockResolvedValueOnce({ id: 'log-2' });
    const { service, transport } = build(create);

    const result = await service.sendFromTemplate('mdm.lock_notice', { amount: '1' }, 'U-1', {
      relatedId: 'ct-1',
      customerId: 'cus-1',
    });

    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(transport.sendLine).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ id: 'log-2', status: 'SENT' });
  });

  it('ลง log พังทั้งสองครั้ง → ไม่ส่งทางข้อความ · Sentry warning ไม่มีผู้รับ/ข้อความ', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('U-1 ค้าง'), { code: 'P2002' }));
    const { service, transport } = build(create);

    const result = await service.sendFromTemplate('mdm.lock_notice', { amount: '1' }, 'U-1', {
      relatedId: 'ct-1',
      customerId: 'cus-1',
    });

    expect(transport.sendLine).not.toHaveBeenCalled();
    expect(result).toEqual({ id: null, status: 'SENT' });
    const [, ctx] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(JSON.stringify(ctx)).not.toMatch(/U-1|ค้าง/);
    expect(ctx.extra).toMatchObject({ relatedId: 'ct-1', status: 'SENT', error: 'P2002' });
  });

  it('push ไม่ผ่าน → ตกไปทางข้อความตามเดิม · แจ้งล็อก (ยกเว้นช่วงผ่อนผัน — M5) ยกเว้นต่อในทางข้อความด้วย', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'log-text' });
    const { service, transport, prisma } = build(
      create,
      jest.fn().mockRejectedValue(new Error('LINE 500')),
    );

    await service.sendFromTemplate('mdm.lock_notice', { amount: '1' }, 'U-1', {
      relatedId: 'ct-1',
    });

    expect(transport.sendLine).toHaveBeenCalledTimes(1);
    // เดิมทางข้อความของ `send()` ไม่รู้ข้อยกเว้นของแม่แบบ ⇒ ถามช่วงผ่อนผัน (และระงับแจ้งล็อกของลูกค้านำเข้า)
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });

  it('แม่แบบทวงอื่น (ไม่ยกเว้น) ทางข้อความยังถามช่วงผ่อนผันตามเดิม', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'log-text' });
    const { service, prisma } = build(create, jest.fn().mockRejectedValue(new Error('LINE 500')));

    await service.sendFromTemplate('dunning.notice', { amount: '1' }, 'U-1', { relatedId: 'ct-1' });

    expect(prisma.contract.findFirst).toHaveBeenCalled();
  });
});
