import { Test, TestingModule } from '@nestjs/testing';
import { AutoTriggerService } from './auto-trigger.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatRoomService } from './chat-room.service';
import { FinanceConfigService } from './finance-config.service';
import { bangkokStartOfDay } from '../../../utils/date.util';

/** เที่ยงคืนไทยของวันนี้ + offset วัน — หน้าต่างวันของบอทเป็นวันไทยไม่ขึ้นกับ TZ เครื่อง (Task 30 รอบ 3 C1) */
const bkkDay = (offset: number) => new Date(bangkokStartOfDay().getTime() + offset * 86_400_000);

describe('AutoTriggerService', () => {
  let service: AutoTriggerService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessions: any;

  const makePayment = (installmentNo: number, dueDate: Date) => ({
    id: `pay-${installmentNo}`,
    installmentNo,
    dueDate,
    amountDue: 3500,
    amountPaid: 0,
    contractId: 'con-1',
    lateFeeWaived: false,
    contract: {
      customerId: 'cust-1',
      customer: {
        id: 'cust-1',
        name: 'สมชาย',
        lineLinks: [{ lineUserId: 'U123' }],
      },
    },
  });

  beforeEach(async () => {
    prisma = {
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      chatAutoTrigger: {
        create: jest.fn().mockResolvedValue({ id: 'trig-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      // No late-fee config rows → BUSINESS_RULES defaults (tier1=50, tier2=100, minDays=3)
      // loadLateFeeConfig uses findUnique (not findFirst)
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      // Task 30 ข้อ 1 — A1 (notification reminder 08:00) ยังไม่ได้ส่งงวดนี้วันนี้
      notificationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        // รอบ 4 I2 — ยังไม่มีสัญญาไหนได้ข้อความทวงระดับสัญญาวันนี้
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Task 30 ข้อ 2 — ไม่มีสัญญาในช่วงผ่อนผันหลังผูก LINE
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    lineClient = {
      pushText: jest.fn().mockResolvedValue(undefined),
    };
    sessions = {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoTriggerService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineFinanceClientService, useValue: lineClient },
        { provide: ChatRoomService, useValue: sessions },
        {
          provide: FinanceConfigService,
          useValue: { bankInfoBlock: '🏦 Test Bank\n🔢 123-456' },
        },
      ],
    }).compile();

    service = module.get(AutoTriggerService);
  });

  it('sends reminders for payments due on target date', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    prisma.payment.findMany.mockResolvedValue([makePayment(3, tomorrow)]);

    await service.runDailyReminders();

    expect(lineClient.pushText).toHaveBeenCalledWith('U123', expect.stringContaining('ครบกำหนด'));
    expect(prisma.chatAutoTrigger.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('skips payments without LINE link', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    const payment = makePayment(3, tomorrow);
    payment.contract.customer.lineLinks = [];
    prisma.payment.findMany.mockResolvedValue([payment]);

    await service.runDailyReminders();

    expect(lineClient.pushText).not.toHaveBeenCalled();
  });

  it('skips duplicate triggers (P2002 = idempotent)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    prisma.payment.findMany.mockResolvedValue([makePayment(3, tomorrow)]);
    prisma.chatAutoTrigger.create.mockRejectedValue({ code: 'P2002' });

    await service.runDailyReminders();

    expect(lineClient.pushText).not.toHaveBeenCalled();
  });

  it('marks trigger as FAILED when LINE push fails', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    prisma.payment.findMany.mockResolvedValue([makePayment(3, tomorrow)]);
    lineClient.pushText.mockRejectedValue(new Error('LINE API down'));

    await service.runDailyReminders();

    expect(prisma.chatAutoTrigger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'LINE API down' }),
      }),
    );
  });

  it('processes escalation offsets (T+1, T+3)', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    prisma.payment.findMany.mockResolvedValue([makePayment(3, yesterday)]);

    await service.runDailyEscalations();

    expect(lineClient.pushText).toHaveBeenCalled();
  });

  it('T+3 escalation quotes flat-bracket tier2 fine 100 (3 days >= minDays 3)', async () => {
    // runDailyEscalations runs processOffset(-1) then processOffset(-3). Return the
    // overdue payment ONLY for the T+3 window (dueDate strictly more than 1 day ago)
    // by matching the window start against a 3-day-old midnight boundary.
    const dueDate = bkkDay(-3);
    prisma.payment.findMany.mockImplementation(({ where }: { where: { dueDate: { gte: Date } } }) =>
      Promise.resolve(
        where.dueDate.gte.getTime() === dueDate.getTime() ? [makePayment(3, dueDate)] : [],
      ),
    );

    await service.runDailyEscalations();

    // 3 days overdue >= tier2MinDays default (3) → flat tier2 = 100
    expect(lineClient.pushText).toHaveBeenCalledWith(
      'U123',
      expect.stringContaining('ค่าปรับ 100.00'),
    );
    // Total = amount 3500 + 100 = 3600.00
    const sentText = (lineClient.pushText as jest.Mock).mock.calls[0][1] as string;
    expect(sentText).toContain('3,600.00');
  });

  it('T+3 escalation honors a configured tier2 amount from SystemConfig', async () => {
    // Configured tier2=90 (3 days overdue still >= default minDays 3 → tier2 applies)
    const dueDate = bkkDay(-3);
    prisma.payment.findMany.mockImplementation(({ where }: { where: { dueDate: { gte: Date } } }) =>
      Promise.resolve(
        where.dueDate.gte.getTime() === dueDate.getTime() ? [makePayment(3, dueDate)] : [],
      ),
    );
    prisma.systemConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'late_fee_tier2_amount' ? { value: '90' } : null),
    );

    await service.runDailyEscalations();

    expect(lineClient.pushText).toHaveBeenCalledWith(
      'U123',
      expect.stringContaining('ค่าปรับ 90.00'),
    );
  });

  it.each([0, 50, 175])(
    'T+3 reminder keeps stored fee %s after partial payment',
    async (lateFee) => {
      const dueDate = bkkDay(-3);
      const payment = { ...makePayment(3, dueDate), amountPaid: 1000, lateFee };
      prisma.payment.findMany.mockImplementation(
        ({ where }: { where: { dueDate: { gte: Date } } }) =>
          Promise.resolve(where.dueDate.gte.getTime() === dueDate.getTime() ? [payment] : []),
      );

      await service.runDailyEscalations();

      const sentText = lineClient.pushText.mock.calls[0][1] as string;
      const expectedTotal = (2500 + lateFee).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(sentText).toContain(expectedTotal);
      if (lateFee > 0) expect(sentText).toContain(`ค่าปรับ ${lateFee.toFixed(2)}`);
    },
  );

  describe('Task 30 ข้อ 1 — งวดละหนึ่งข้อความต่อวัน (A1 08:00 เป็นตัวหลัก บอทเป็นตัวสำรอง)', () => {
    it.each([5, 3, 1, 0])(
      'T-%i: A1 ส่งเตือนงวดนี้แล้ววันนี้ → บอทไม่ส่ง และไม่จองแถว chat_auto_triggers',
      async (offset) => {
        const due = bkkDay(offset);
        prisma.payment.findMany.mockImplementation(
          ({ where }: { where: { dueDate: { gte: Date } } }) =>
            Promise.resolve(
              where.dueDate.gte.getTime() === due.getTime() ? [makePayment(3, due)] : [],
            ),
        );
        prisma.notificationLog.findFirst.mockResolvedValue({ id: 'a1-log' });

        await service.runDailyReminders();

        expect(lineClient.pushText).not.toHaveBeenCalled();
        expect(prisma.chatAutoTrigger.create).not.toHaveBeenCalled();
        expect(prisma.notificationLog.findFirst.mock.calls[0][0].where.relatedId).toBe('pay-3');
      },
    );

    it('A1 ยังไม่ได้ส่ง (ข้าม consent / ส่งไม่ผ่าน / สัญญาไม่ ACTIVE) → บอทส่งตามเดิม', async () => {
      const due = new Date();
      due.setDate(due.getDate() + 3);
      prisma.payment.findMany.mockResolvedValue([makePayment(3, due)]);

      await service.runDailyReminders();

      expect(lineClient.pushText).toHaveBeenCalled();
      expect(prisma.chatAutoTrigger.create).toHaveBeenCalled();
    });
  });

  describe('Task 30 รอบ 2 ข้อ 3 — ทวง T+1/T+3 งวดละหนึ่งข้อความต่อวัน (A2 09:00 ตัวหลัก · บอท 10:00 ตัวสำรอง)', () => {
    it.each([1, 3])(
      'T+%i: A2 แจ้งค้างชำระงวดนี้แล้ววันนี้ → บอทไม่ส่ง ไม่จองแถว',
      async (daysOverdue) => {
        const due = bkkDay(-daysOverdue);
        prisma.payment.findMany.mockImplementation(
          ({ where }: { where: { dueDate: { gte: Date } } }) =>
            Promise.resolve(
              where.dueDate.gte.getTime() === due.getTime() ? [makePayment(3, due)] : [],
            ),
        );
        prisma.notificationLog.findFirst.mockResolvedValue({ id: 'a2-log' });

        await service.runDailyEscalations();

        expect(lineClient.pushText).not.toHaveBeenCalled();
        expect(prisma.chatAutoTrigger.create).not.toHaveBeenCalled();
        // ถามแถวแจ้งค้างชำระของ A2 (หัวข้อ Flex หรือหมวด DUNNING ของงวดนี้) ไม่ใช่แถวเตือนค่างวด
        const where = prisma.notificationLog.findFirst.mock.calls[0][0].where;
        expect(where.relatedId).toBe('pay-3');
        expect(where.AND[0]).toEqual({
          OR: [{ subject: 'แจ้งค้างชำระ' }, { category: 'DUNNING' }],
        });
      },
    );

    it('รอบ 4 I2: สัญญาได้ข้อความทวงระดับสัญญาแล้ววันนี้ (A2 เว้นให้) → บอทไม่ส่งแทน ไม่จองแถว', async () => {
      const due = bkkDay(-1);
      prisma.payment.findMany.mockImplementation(
        ({ where }: { where: { dueDate: { gte: Date } } }) =>
          Promise.resolve(
            where.dueDate.gte.getTime() === due.getTime() ? [makePayment(3, due)] : [],
          ),
      );
      prisma.notificationLog.findMany.mockResolvedValue([{ relatedId: 'con-1' }]);

      await service.runDailyEscalations();

      expect(lineClient.pushText).not.toHaveBeenCalled();
      expect(prisma.chatAutoTrigger.create).not.toHaveBeenCalled();
      expect(prisma.notificationLog.findMany.mock.calls[0][0].where.category).toBe('DUNNING');
    });

    it('รอบ 5 (เจ้าของ 01/11 ข้อ 1): เตือนค่างวด (T-5..T0) ของสัญญาที่ได้ข้อความทวงแล้ววันนี้ → ไม่ส่ง ไม่จองแถว', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment(3, bkkDay(1))]);
      prisma.notificationLog.findMany.mockResolvedValue([{ relatedId: 'con-1' }]);

      await service.runDailyReminders();

      expect(lineClient.pushText).not.toHaveBeenCalled();
      expect(prisma.chatAutoTrigger.create).not.toHaveBeenCalled();
    });

    it('เตือนค่างวดของสัญญาที่ยังไม่ได้ข้อความทวงวันนี้ → ส่งตามเดิม', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment(3, bkkDay(1))]);

      await service.runDailyReminders();

      expect(prisma.notificationLog.findMany).toHaveBeenCalled();
      expect(lineClient.pushText).toHaveBeenCalled();
    });

    it('A2 ยังไม่ได้แจ้ง (ไม่มี consent / ส่งไม่ผ่านจนหมดรอบ) → บอทส่งตามเดิม', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      prisma.payment.findMany.mockResolvedValue([makePayment(3, yesterday)]);

      await service.runDailyEscalations();

      expect(lineClient.pushText).toHaveBeenCalled();
    });
  });

  describe('Task 30 ข้อ 2 — ผ่อนผัน 7 วันหลังผูก LINE (สัญญานำเข้า)', () => {
    it('ทวง T+1/T+3 ของสัญญาในช่วงผ่อนผัน → ไม่ส่ง ไม่จองแถว · แถว BLOCKED LEGACY_LINK_GRACE', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      prisma.payment.findMany.mockResolvedValue([makePayment(3, yesterday)]);
      prisma.contract.findMany.mockResolvedValue([{ id: 'con-1' }]);
      prisma.notificationLog.create = jest.fn().mockResolvedValue({ id: 'log' });

      await service.runDailyEscalations();

      expect(lineClient.pushText).not.toHaveBeenCalled();
      expect(prisma.chatAutoTrigger.create).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipient: 'U123',
            status: 'BLOCKED',
            blockReason: 'LEGACY_LINK_GRACE',
            category: 'DUNNING',
            relatedId: 'pay-3',
            customerId: 'cust-1',
          }),
        }),
      );
      expect(prisma.contract.findMany.mock.calls[0][0].where.id).toEqual({ in: ['con-1'] });
    });

    it('เตือนค่างวด T-5..T0 ไม่ถามช่วงผ่อนผัน (ยังส่งระหว่างผ่อนผัน)', async () => {
      const due = new Date();
      due.setDate(due.getDate() + 3);
      prisma.payment.findMany.mockResolvedValue([makePayment(3, due)]);
      prisma.contract.findMany.mockResolvedValue([{ id: 'con-1' }]);

      await service.runDailyReminders();

      expect(prisma.contract.findMany).not.toHaveBeenCalled();
      expect(lineClient.pushText).toHaveBeenCalled();
    });
  });

  it('does nothing when no payments match', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    await service.runDailyReminders();

    expect(lineClient.pushText).not.toHaveBeenCalled();
  });

  it('saves reminder message to chat session', async () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 5);
    prisma.payment.findMany.mockResolvedValue([makePayment(3, targetDate)]);

    await service.runDailyReminders();

    expect(sessions.getOrCreate).toHaveBeenCalledWith('U123');
    expect(sessions.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'sess-1',
        role: 'AUTO_TRIGGER',
      }),
    );
  });

  it('catches top-level errors without crashing (Sentry capture)', async () => {
    prisma.payment.findMany.mockRejectedValue(new Error('DB error'));

    // Should not throw
    await expect(service.runDailyReminders()).resolves.not.toThrow();
  });
});
