import { Test, TestingModule } from '@nestjs/testing';
import { AutoTriggerService } from './auto-trigger.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatSessionService } from './chat-session.service';

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
        { provide: ChatSessionService, useValue: sessions },
      ],
    }).compile();

    service = module.get(AutoTriggerService);
  });

  it('sends reminders for payments due on target date', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    prisma.payment.findMany.mockResolvedValue([makePayment(3, tomorrow)]);

    await service.runDailyReminders();

    expect(lineClient.pushText).toHaveBeenCalledWith(
      'U123',
      expect.stringContaining('ครบกำหนด'),
    );
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
        sessionId: 'sess-1',
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
