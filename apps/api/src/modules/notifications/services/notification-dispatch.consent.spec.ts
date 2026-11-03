import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Task 34 รอบเก็บ (ผู้คุมงานข้อ 4) — ทาง Flex ของ `sendFromTemplate` ไม่ผ่าน `ComplianceService.canSend` ⇒ แม่แบบขั้นทวง `dunning.*`
 * (A4 รอบ 08:05) ส่งถึงลูกค้าที่ไม่มีความยินยอม PDPA · ใส่ด่านเดียวกับ A1/A2/A6/บอท (`ensurePdpaConsentOrLogSkip`) ·
 * **แจ้งล็อกเครื่อง `mdm.lock_notice` ไม่ถูกแตะ** (คำสั่งเจ้าของ: ห้ามเปลี่ยนเรื่อง MDM)
 */
describe('NotificationDispatchService.sendFromTemplate — ด่านความยินยอมของแม่แบบขั้นทวง dunning.*', () => {
  function build(opts: { consent: boolean; format?: 'flex' | 'text'; category?: string }) {
    const prisma = {
      // ไม่อยู่ในช่วงผ่อนผันหลังผูก LINE
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      pDPAConsent: {
        findFirst: jest.fn().mockResolvedValue(opts.consent ? { id: 'consent-1' } : null),
      },
      chatRoom: { findFirst: jest.fn().mockResolvedValue(null) },
      chatMessage: { create: jest.fn() },
      notificationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };
    const transport = {
      sendLineFlexMessage: jest.fn().mockResolvedValue(undefined),
      sendLine: jest.fn().mockResolvedValue(undefined),
    };
    const templates = {
      findByEventType: jest.fn().mockResolvedValue({
        isActive: true,
        format: opts.format ?? 'flex',
        channel: 'LINE',
        channelKey: 'line-finance',
        flexTemplate: JSON.stringify({ type: 'bubble' }),
        messageTemplate: '[BESTCHOICE FINANCE] ค้างชำระ ${amount}',
        name: 'แจ้งเตือนค้างชำระ (REMINDER)',
        subject: null,
        category: opts.category ?? 'DUNNING',
      }),
    };
    const compliance = {
      canSend: jest.fn().mockResolvedValue({ allowed: true }),
      ensureIdentificationPrefix: jest.fn((msg: string) => msg),
      scanForbiddenContent: jest.fn(),
    };
    const service = new NotificationDispatchService(
      transport as never,
      prisma as never,
      compliance as never,
      templates as never,
    );
    return { prisma, transport, compliance, service };
  }
  const target = { relatedId: 'k1', customerId: 'cust-1' };

  it.each(['dunning.reminder', 'dunning.notice', 'dunning.final_warning', 'dunning.legal_action'])(
    '%s ลูกค้าไม่มีความยินยอม → ไม่ส่ง Flex · แถว IN_APP SKIPPED แบบเดียวกับ A1/A2 · คืน BLOCKED NO_CONSENT',
    async (eventType) => {
      const { prisma, transport, service } = build({ consent: false });

      const result = await service.sendFromTemplate(eventType, { amount: '1' }, 'U-1', target);

      expect(result).toEqual({ id: null, status: 'BLOCKED', blockReason: 'NO_CONSENT' });
      expect(transport.sendLineFlexMessage).not.toHaveBeenCalled();
      expect(transport.sendLine).not.toHaveBeenCalled();
      expect(prisma.pDPAConsent.findFirst).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', status: 'GRANTED', deletedAt: null },
        select: { id: true },
      });
      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          channel: 'IN_APP',
          recipient: 'cust-1',
          subject: 'แจ้งเตือนค้างชำระ (REMINDER)',
          message: 'ข้ามการแจ้งเตือน — ลูกค้าไม่มี PDPA consent',
          status: 'SKIPPED',
          relatedId: 'k1',
        },
      });
    },
  );

  it('dunning.* มีความยินยอม → ส่ง Flex ตามเดิม', async () => {
    const { transport, service } = build({ consent: true });
    const result = await service.sendFromTemplate(
      'dunning.reminder',
      { amount: '1' },
      'U-1',
      target,
    );
    expect(result.status).toBe('SENT');
    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
  });

  it('แจ้งล็อกเครื่อง mdm.lock_notice ไม่มีความยินยอม → ส่ง Flex ตามเดิม ไม่ถามความยินยอม (ไม่แตะ MDM — ตั้งใจ)', async () => {
    const { prisma, transport, service } = build({ consent: false });
    const result = await service.sendFromTemplate(
      'mdm.lock_notice',
      { amount: '1' },
      'U-1',
      target,
    );
    expect(result.status).toBe('SENT');
    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['พนักงานกดส่งเอง (manual)', { manual: true }],
    ['bypassCompliance', { bypassCompliance: true }],
  ])('%s → ไม่ถามความยินยอม (ส่งด้วยมือยังตามกติกาเดิม)', async (_label, extra) => {
    const { prisma, transport, service } = build({ consent: false });
    await service.sendFromTemplate('dunning.reminder', { amount: '1' }, 'U-1', {
      ...target,
      ...extra,
    });
    expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
  });

  it('แม่แบบ dunning.* แบบข้อความ (ไม่ใช่ Flex) → ไม่ถามที่นี่ — ทางข้อความผ่าน canSend อยู่แล้ว', async () => {
    const { prisma, compliance, service } = build({ consent: false, format: 'text' });
    await service.sendFromTemplate('dunning.reminder', { amount: '1' }, 'U-1', target);
    expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
    expect(compliance.canSend).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', category: 'DUNNING' }),
    );
  });
});
