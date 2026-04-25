import { Test, TestingModule } from '@nestjs/testing';
import { DunningEngineService } from './dunning-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningRuleService } from './dunning-rule.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';

// Suppress Sentry in tests
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const mockPrisma = {
  payment: { findMany: jest.fn(), findUnique: jest.fn() },
  dunningAction: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  dunningRule: { findFirst: jest.fn() },
  contract: { findUnique: jest.fn() },
};

const mockRuleService = {
  findAllActiveRules: jest.fn(),
};

const mockNotificationsService = {
  send: jest.fn(),
};

const mockPaymentLinkService = {
  createPaymentLink: jest.fn(),
};

// Sample payment fixture
const TODAY = new Date('2026-04-15T00:00:00.000Z');
const DUE_IN_3_DAYS = new Date('2026-04-18T00:00:00.000Z');

const samplePayment = {
  id: 'pay-1',
  contractId: 'c-1',
  installmentNo: 3,
  dueDate: DUE_IN_3_DAYS,
  status: 'PENDING',
  amountDue: { toNumber: () => 5000 },
  amountPaid: { toNumber: () => 0 },
  lateFee: { toNumber: () => 0 },
  contract: {
    id: 'c-1',
    contractNumber: 'BC-001',
    status: 'ACTIVE',
    customer: {
      id: 'cust-1',
      name: 'สมชาย',
      lineId: 'U123',
      phone: '0812345678',
    },
  },
};

const sampleRule = {
  id: 'rule-1',
  name: 'Pre-due 3 days',
  triggerDay: -3,
  channel: 'LINE',
  messageTemplate: 'สวัสดีคุณ{{customerName}} สัญญา{{contractNumber}} งวดที่{{installmentNo}} ครบ{{dueDate}} จำนวน{{amount}} บาท',
  includePaymentLink: false,
  autoExecute: true,
  sortOrder: 0,
  isActive: true,
};

describe('DunningEngineService', () => {
  let service: DunningEngineService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DunningRuleService, useValue: mockRuleService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: PaymentLinkService, useValue: mockPaymentLinkService },
      ],
    }).compile();

    service = module.get<DunningEngineService>(DunningEngineService);
  });

  // --- renderTemplate tests ---

  describe('renderTemplate', () => {
    it('should replace all known variables correctly', () => {
      const template = 'สวัสดีคุณ{{customerName}} สัญญา{{contractNumber}} งวดที่{{installmentNo}} ครบ{{dueDate}} จำนวน{{amount}} บาท เกิน{{daysOverdue}} วัน';
      const vars = {
        customerName: 'สมชาย',
        contractNumber: 'BC-001',
        amount: '5,000',
        dueDate: '15/04/2569',
        daysOverdue: '3',
        installmentNo: '3',
      };
      const result = service.renderTemplate(template, vars);
      expect(result).toBe('สวัสดีคุณสมชาย สัญญาBC-001 งวดที่3 ครบ15/04/2569 จำนวน5,000 บาท เกิน3 วัน');
    });

    it('should leave unknown variables as-is', () => {
      const template = 'สวัสดีคุณ{{customerName}} {{unknownVar}}';
      const vars = {
        customerName: 'สมชาย',
        contractNumber: 'BC-001',
        amount: '5,000',
        dueDate: '15/04/2569',
        daysOverdue: '0',
        installmentNo: '1',
      };
      const result = service.renderTemplate(template, vars);
      expect(result).toBe('สวัสดีคุณสมชาย {{unknownVar}}');
    });
  });

  // --- hasExistingAction tests ---

  describe('hasExistingAction', () => {
    it('should return true when an action already exists', async () => {
      mockPrisma.dunningAction.findFirst.mockResolvedValueOnce({ id: 'action-1' });
      const result = await service.hasExistingAction('rule-1', 'c-1', 'pay-1');
      expect(result).toBe(true);
      expect(mockPrisma.dunningAction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dunningRuleId: 'rule-1', contractId: 'c-1' }),
        }),
      );
    });

    it('should return false when no action exists', async () => {
      mockPrisma.dunningAction.findFirst.mockResolvedValueOnce(null);
      const result = await service.hasExistingAction('rule-1', 'c-1', 'pay-1');
      expect(result).toBe(false);
    });
  });

  // --- executeRules tests ---

  describe('executeRules', () => {
    beforeEach(() => {
      // Default: no existing action
      mockPrisma.dunningAction.findFirst.mockResolvedValue(null);
      mockPrisma.dunningAction.create.mockResolvedValue({ id: 'new-action-1' });
      mockNotificationsService.send.mockResolvedValue({ id: 'notif-1', status: 'SENT' });
    });

    it('should process a pre-due rule, send LINE notification, and create action record', async () => {
      mockRuleService.findAllActiveRules.mockResolvedValueOnce([sampleRule]);
      mockPrisma.payment.findMany.mockResolvedValueOnce([samplePayment]);

      const result = await service.executeRules();

      expect(result.executed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);

      expect(mockNotificationsService.send).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'LINE',
          recipient: 'U123',
          relatedId: 'c-1',
        }),
      );

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dunningRuleId: 'rule-1',
            contractId: 'c-1',
            paymentId: 'pay-1',
            channel: 'LINE',
            status: 'SENT',
          }),
        }),
      );
    });

    it('should skip when a DunningAction already exists (dedup)', async () => {
      mockRuleService.findAllActiveRules.mockResolvedValueOnce([sampleRule]);
      mockPrisma.payment.findMany.mockResolvedValueOnce([samplePayment]);
      // Simulate existing action
      mockPrisma.dunningAction.findFirst.mockResolvedValue({ id: 'existing-action' });

      const result = await service.executeRules();

      expect(result.skipped).toBe(1);
      expect(result.executed).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
      expect(mockPrisma.dunningAction.create).not.toHaveBeenCalled();
    });
  });

  // --- executeEventTrigger tests ---

  describe('executeEventTrigger', () => {
    const eventRule = {
      id: 'rule-event-1',
      name: 'ไม่รับสาย — ส่ง LINE',
      triggerDay: null,
      eventTrigger: 'CALL_NO_ANSWER',
      channel: 'LINE',
      messageTemplate: 'สวัสดีคุณ{{customerName}} เราพยายามติดต่อแต่ไม่ได้รับสาย',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 0,
      isActive: true,
    };

    const sampleContract = {
      id: 'c-1',
      contractNumber: 'BC-001',
      customer: {
        name: 'สมชาย',
        lineId: 'U123',
        phone: '0812345678',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockPrisma.dunningRule.findFirst.mockResolvedValue(eventRule);
      mockPrisma.dunningAction.findFirst.mockResolvedValue(null); // no recent dedup
      mockPrisma.contract.findUnique.mockResolvedValue(sampleContract);
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      mockPrisma.dunningAction.create.mockResolvedValue({ id: 'action-evt-1' });
      mockNotificationsService.send.mockResolvedValue({ id: 'notif-test', status: 'SENT' });
    });

    it('creates a DunningAction with SENT status when a matching event rule + recipient exist', async () => {
      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dunningRuleId: 'rule-event-1',
            contractId: 'c-1',
            channel: 'LINE',
            status: 'SENT',
          }),
        }),
      );
      expect(mockNotificationsService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'LINE',
          recipient: 'U123',
          relatedId: 'c-1',
        }),
      );
    });

    it('dedups within 4h window — second call skipped', async () => {
      // First call: no recent action
      mockPrisma.dunningAction.findFirst.mockResolvedValueOnce(null);
      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

      // Second call: recent action exists (dedup)
      mockPrisma.dunningAction.findFirst.mockResolvedValueOnce({ id: 'action-evt-1' });
      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-2');

      // create should only have been called once
      expect(mockPrisma.dunningAction.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.send).toHaveBeenCalledTimes(1);
    });

    it('no-op when no matching active rule', async () => {
      mockPrisma.dunningRule.findFirst.mockResolvedValueOnce(null);

      await service.executeEventTrigger('BROKEN_PROMISE', 'c-1', null, null);

      expect(mockPrisma.dunningAction.create).not.toHaveBeenCalled();
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
    });

    it('no-op when contract not found', async () => {
      mockPrisma.contract.findUnique.mockResolvedValueOnce(null);

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-missing', null, null);

      expect(mockPrisma.dunningAction.create).not.toHaveBeenCalled();
    });

    it('creates action with SKIPPED status when customer has no lineId', async () => {
      mockPrisma.contract.findUnique.mockResolvedValueOnce({
        ...sampleContract,
        customer: { ...sampleContract.customer, lineId: null },
      });

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, null);

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED' }),
        }),
      );
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
    });

    it('creates action with FAILED status and captures to Sentry when send throws', async () => {
      const sendError = new Error('LINE API timeout');
      mockNotificationsService.send.mockRejectedValueOnce(sendError);

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            result: 'LINE API timeout',
          }),
        }),
      );
    });
  });
});
