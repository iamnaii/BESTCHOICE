import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Task 30 ข้อ 2 — template หมวดทวง (DUNNING) ช่อง LINE ของสัญญานำเข้าที่ผูก LINE ยังไม่ครบ 7 วัน ถูกระงับ**ก่อนทาง Flex**
 * (ทาง Flex ของ `sendFromTemplate` ไม่ผ่าน `ComplianceService.canSend`) — A4 `dunning.*` · `mdm.lock_notice` · `payment.overdue_day_*`
 */
describe('NotificationDispatchService.sendFromTemplate — ผ่อนผันหลังผูก LINE (สัญญานำเข้า)', () => {
  function build(opts: { inGrace: boolean; category?: string; channel?: 'LINE' | 'SMS' }) {
    const prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue(opts.inGrace ? { id: 'k1' } : null) },
      // Task 34 รอบเก็บ — แม่แบบ dunning.* ทาง Flex ถามความยินยอม PDPA (ลูกค้าในเคสเหล่านี้มี)
      pDPAConsent: { findFirst: jest.fn().mockResolvedValue({ id: 'consent-1' }) },
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
        format: 'flex',
        channel: opts.channel ?? 'LINE',
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

  it('DUNNING ช่อง LINE ในช่วงผ่อนผัน → ไม่ส่ง · แถว BLOCKED เหตุผล LEGACY_LINK_GRACE', async () => {
    const { prisma, transport, service } = build({ inGrace: true });

    const result = await service.sendFromTemplate(
      'dunning.reminder',
      { amount: '1,515.83' },
      'U-1',
      {
        relatedId: 'k1',
        customerId: 'cust-1',
      },
    );

    expect(result).toEqual({ id: 'log-1', status: 'BLOCKED', blockReason: 'LEGACY_LINK_GRACE' });
    expect(transport.sendLineFlexMessage).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create.mock.calls[0][0]).toMatchObject({
      data: expect.objectContaining({
        channel: 'LINE',
        recipient: 'U-1',
        status: 'BLOCKED',
        blockReason: 'LEGACY_LINK_GRACE',
        category: 'DUNNING',
        relatedId: 'k1',
        customerId: 'cust-1',
        sentAt: null,
      }),
    });
    expect(prisma.contract.findFirst.mock.calls[0][0].where.OR).toEqual([
      { id: 'k1' },
      { payments: { some: { id: 'k1' } } },
    ]);
  });

  it('DUNNING นอกช่วงผ่อนผัน → ส่ง Flex ตามเดิม', async () => {
    const { transport, service } = build({ inGrace: false });
    const result = await service.sendFromTemplate('dunning.reminder', { amount: '1' }, 'U-1', {
      relatedId: 'k1',
      customerId: 'cust-1',
    });
    expect(result.status).toBe('SENT');
    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['REMINDER', 'LINE'],
    ['TRANSACTIONAL', 'LINE'],
  ] as const)('หมวด %s → ไม่ถามช่วงผ่อนผัน ส่งตามเดิม', async (category, channel) => {
    const { prisma, transport, service } = build({ inGrace: true, category, channel });
    await service.sendFromTemplate('evt', { amount: '1' }, 'U-1', {
      relatedId: 'k1',
      customerId: 'cust-1',
    });
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
  });

  it('bypassCompliance → ไม่ระงับ (ตรงกับ canSend)', async () => {
    const { transport, service } = build({ inGrace: true });
    await service.sendFromTemplate('dunning.reminder', { amount: '1' }, 'U-1', {
      relatedId: 'k1',
      customerId: 'cust-1',
      bypassCompliance: true,
    });
    expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
  });

  describe('รอบ 2 ข้อ 2 — ส่งด้วยมือ (พนักงานกด) ไม่ถูกระงับ · ระงับเฉพาะที่ระบบส่งเอง', () => {
    const dunningLine = {
      channel: 'LINE' as const,
      channelKey: 'line-finance' as const,
      recipient: 'U-1',
      message: '[BESTCHOICE FINANCE] กรุณาชำระ',
      relatedId: 'k1',
      customerId: 'cust-1',
      category: 'DUNNING' as never,
    };

    it('send() ที่ระบบส่งเอง (ไม่ระบุ manual) ในช่วงผ่อนผัน → BLOCKED ก่อนด่าน compliance ไม่ส่ง', async () => {
      const { prisma, transport, compliance, service } = build({ inGrace: true });

      const result = await service.send(dunningLine);

      expect(result).toEqual({ id: 'log-1', status: 'BLOCKED', blockReason: 'LEGACY_LINK_GRACE' });
      expect(compliance.canSend).not.toHaveBeenCalled();
      expect(transport.sendLine).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create.mock.calls[0][0]).toMatchObject({
        data: expect.objectContaining({ status: 'BLOCKED', blockReason: 'LEGACY_LINK_GRACE' }),
      });
    });

    it('send(dto, { manual: true }) ในช่วงผ่อนผัน → ไม่ถามช่วงผ่อนผัน ผ่านด่าน compliance เดิมแล้วส่ง', async () => {
      const { prisma, transport, compliance, service } = build({ inGrace: true });

      const result = await service.send(dunningLine, { manual: true });

      expect(result.status).toBe('SENT');
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(compliance.canSend).toHaveBeenCalledTimes(1);
      expect(transport.sendLine).toHaveBeenCalledWith('U-1', expect.any(String), 'line-finance');
    });

    it('sendFromTemplate(..., { manual: true }) ในช่วงผ่อนผัน → ส่ง Flex', async () => {
      const { prisma, transport, service } = build({ inGrace: true });

      const result = await service.sendFromTemplate('dunning.reminder', { amount: '1' }, 'U-1', {
        relatedId: 'k1',
        customerId: 'cust-1',
        manual: true,
      });

      expect(result.status).toBe('SENT');
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('รอบ 3 M5 — แจ้งล็อกเครื่องไม่ถูกระงับ (การล็อกยังเกิด ลูกค้าต้องรู้เหตุผล)', () => {
    it("sendFromTemplate('mdm.lock_notice') ในช่วงผ่อนผัน → ส่ง Flex · ไม่ถามช่วงผ่อนผัน", async () => {
      const { prisma, transport, service } = build({ inGrace: true });

      const result = await service.sendFromTemplate('mdm.lock_notice', { name: 'สมชาย' }, 'U-1', {
        relatedId: 'k1',
        customerId: 'cust-1',
      });

      expect(result.status).toBe('SENT');
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(transport.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    });

    it('send(dto, { legacyGraceExempt: true }) (กฎทวงแจ้งล็อก/ปลดล็อก) ในช่วงผ่อนผัน → ส่ง', async () => {
      const { prisma, transport, service } = build({ inGrace: true });

      const result = await service.send(
        {
          channel: 'LINE',
          channelKey: 'line-finance',
          recipient: 'U-1',
          message: '[BESTCHOICE FINANCE] เครื่องของท่านถูกล็อค',
          relatedId: 'k1',
          customerId: 'cust-1',
          category: 'DUNNING' as never,
        },
        { legacyGraceExempt: true },
      );

      expect(result.status).toBe('SENT');
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(transport.sendLine).toHaveBeenCalledTimes(1);
    });
  });
});
