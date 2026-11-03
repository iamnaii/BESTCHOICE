import { Test, TestingModule } from '@nestjs/testing';
import { DunningEngineService } from './dunning-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningRuleService } from './dunning-rule.service';
import { DunningRuleResolverService } from './dunning-rule-resolver.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';

// Suppress Sentry in tests
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const mockPrisma = {
  payment: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
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

// Default resolver behaviour: no tags, no overrides — every send proceeds.
// Individual tests can re-mock for tag-condition coverage.
const mockResolver = {
  fetchTagsForCustomer: jest.fn().mockResolvedValue([]),
  resolve: jest.fn().mockReturnValue({
    action: 'send',
    delayDays: 0,
    skipSoft: false,
    reason: 'no tag override',
  }),
};

// Sample payment fixture
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
      lineIdFinance: 'U123',
      lineLinks: [{ lineUserId: 'U123' }],
      phone: '0812345678',
    },
  },
};

const sampleRule = {
  id: 'rule-1',
  name: 'Pre-due 3 days',
  triggerDay: -3,
  channel: 'LINE',
  messageTemplate:
    'สวัสดีคุณ{{customerName}} สัญญา{{contractNumber}} งวดที่{{installmentNo}} ครบ{{dueDate}} จำนวน{{amount}} บาท',
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
        { provide: DunningRuleResolverService, useValue: mockResolver },
      ],
    }).compile();

    // Reset resolver to default (send-passthrough) on every test so tag-
    // condition cases that re-mock it don't bleed into the next describe.
    mockResolver.fetchTagsForCustomer.mockResolvedValue([]);
    mockResolver.resolve.mockReturnValue({
      action: 'send',
      delayDays: 0,
      skipSoft: false,
      reason: 'no tag override',
    });

    service = module.get<DunningEngineService>(DunningEngineService);
  });

  // --- renderTemplate tests ---

  describe('renderTemplate', () => {
    it('should replace all known variables correctly', () => {
      const template =
        'สวัสดีคุณ{{customerName}} สัญญา{{contractNumber}} งวดที่{{installmentNo}} ครบ{{dueDate}} จำนวน{{amount}} บาท เกิน{{daysOverdue}} วัน';
      const vars = {
        customerName: 'สมชาย',
        contractNumber: 'BC-001',
        amount: '5,000',
        dueDate: '15/04/2569',
        daysOverdue: '3',
        installmentNo: '3',
      };
      const result = service.renderTemplate(template, vars);
      expect(result).toBe(
        'สวัสดีคุณสมชาย สัญญาBC-001 งวดที่3 ครบ15/04/2569 จำนวน5,000 บาท เกิน3 วัน',
      );
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

    it('ลูกค้าไม่มีเบอร์ (phone null) — LINE ยังส่ง แต่ไม่มี SMS สำรอง (fallbackPhone = undefined ไม่ใช่ null)', async () => {
      mockRuleService.findAllActiveRules.mockResolvedValueOnce([sampleRule]);
      mockPrisma.payment.findMany.mockResolvedValueOnce([
        {
          ...samplePayment,
          contract: {
            ...samplePayment.contract,
            customer: { ...samplePayment.contract.customer, phone: null },
          },
        },
      ]);

      await service.executeRules();

      expect(mockNotificationsService.send).toHaveBeenCalledTimes(1);
      const sent = mockNotificationsService.send.mock.calls[0][0];
      expect(sent.recipient).toBe('U123');
      expect(sent).toHaveProperty('fallbackPhone', undefined);
    });
  });

  describe('Task 30 รอบ 4 m2 — กฎตามวันเลือกงวดตามวันไทย · ทิศ triggerDay ตามหน้าจอ (ลบ = ก่อนครบกำหนด · บวก = เกินกำหนด)', () => {
    // 1 ธ.ค. 2569 08:15 น. ไทย (รอบ 08:15) = 01:15Z
    const now = new Date('2026-12-01T01:15:00Z');
    beforeEach(() => {
      jest.useFakeTimers({
        now,
        doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'clearTimeout'],
      });
      mockPrisma.payment.findMany.mockResolvedValue([]);
    });
    afterEach(() => jest.useRealTimers());

    const whereOfRule = async (triggerDay: number) => {
      mockRuleService.findAllActiveRules.mockResolvedValueOnce([{ ...sampleRule, triggerDay }]);
      await service.executeRules();
      return mockPrisma.payment.findMany.mock.calls.at(-1)![0].where;
    };

    it('triggerDay -3 = งวดที่ครบกำหนดอีก 3 วัน (4 ธ.ค. ไทย) · PENDING ของสัญญา ACTIVE', async () => {
      const where = await whereOfRule(-3);
      expect(where.dueDate).toEqual({
        gte: new Date('2026-12-03T17:00:00.000Z'),
        lt: new Date('2026-12-04T17:00:00.000Z'),
      });
      expect(where.status).toBe('PENDING');
      expect(where.contract.status).toBe('ACTIVE');
    });

    it('triggerDay +1 = งวดที่เกินกำหนด 1 วัน (30 พ.ย. ไทย) · ค้างของสัญญา OVERDUE/DEFAULT', async () => {
      const where = await whereOfRule(1);
      expect(where.dueDate).toEqual({
        gte: new Date('2026-11-29T17:00:00.000Z'),
        lt: new Date('2026-11-30T17:00:00.000Z'),
      });
      expect(where.contract.status).toEqual({ in: ['OVERDUE', 'DEFAULT'] });
    });

    it('triggerDay 0 = วันครบกำหนด (1 ธ.ค. ไทย)', async () => {
      const where = await whereOfRule(0);
      expect(where.dueDate).toEqual({
        gte: new Date('2026-11-30T17:00:00.000Z'),
        lt: new Date('2026-12-01T17:00:00.000Z'),
      });
    });
  });

  describe('Task 30 ข้อ 2 — ผ่อนผัน 7 วันหลังผูก LINE: ข้อความถูกระงับ = SKIPPED ไม่ใช่ FAILED', () => {
    const eventRule = {
      ...sampleRule,
      id: 'rule-event-1',
      triggerDay: null,
      eventTrigger: 'CALL_NO_ANSWER',
    };

    beforeEach(() => {
      mockPrisma.dunningAction.findFirst.mockResolvedValue(null);
      mockPrisma.dunningAction.create.mockResolvedValue({ id: 'a-1' });
    });

    it('รอบกฎตามวัน: send ตอบ BLOCKED LEGACY_LINK_GRACE → DunningAction SKIPPED (ไม่เข้าคิวส่งซ้ำของพนักงาน)', async () => {
      mockRuleService.findAllActiveRules.mockResolvedValueOnce([{ ...sampleRule, triggerDay: 1 }]);
      mockPrisma.payment.findMany.mockResolvedValueOnce([samplePayment]);
      mockNotificationsService.send.mockResolvedValueOnce({
        id: 'log-9',
        status: 'BLOCKED',
        blockReason: 'LEGACY_LINK_GRACE',
      });

      const result = await service.executeRules();

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'SKIPPED',
          result: 'LEGACY_LINK_GRACE notificationId:log-9',
        }),
      });
      expect(result.failed).toBe(0);
    });

    it('กฎตามเหตุการณ์ (ไม่รับสาย ฯลฯ): BLOCKED LEGACY_LINK_GRACE → SKIPPED', async () => {
      mockPrisma.dunningRule.findFirst.mockResolvedValueOnce(eventRule);
      mockPrisma.contract.findUnique.mockResolvedValueOnce(samplePayment.contract);
      // ข้อความใช้งวด/ยอด — สัญญามีงวดค้าง (รอบ 6 m7: ไม่ระบุงวด = ใช้งวดค้างที่เก่าที่สุด)
      mockPrisma.payment.findFirst.mockResolvedValueOnce(samplePayment);
      mockNotificationsService.send.mockResolvedValueOnce({
        id: 'log-10',
        status: 'BLOCKED',
        blockReason: 'LEGACY_LINK_GRACE',
      });

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'SKIPPED',
          result: 'LEGACY_LINK_GRACE notificationId:log-10',
          executedAt: null,
        }),
      });
    });

    it('BLOCKED ด้วยเหตุอื่น (ไม่มี consent) → FAILED ตามเดิม', async () => {
      mockRuleService.findAllActiveRules.mockResolvedValueOnce([sampleRule]);
      mockPrisma.payment.findMany.mockResolvedValueOnce([samplePayment]);
      mockNotificationsService.send.mockResolvedValueOnce({
        id: 'log-11',
        status: 'BLOCKED',
        blockReason: 'NO_CONSENT',
      });

      await service.executeRules();

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED', result: 'notificationId:log-11' }),
      });
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
        lineIdFinance: 'U123',
        lineLinks: [{ lineUserId: 'U123' }],
        phone: '0812345678',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockPrisma.dunningRule.findFirst.mockResolvedValue(eventRule);
      mockPrisma.dunningAction.findFirst.mockResolvedValue(null); // no recent dedup
      mockPrisma.contract.findUnique.mockResolvedValue(sampleContract);
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findFirst.mockResolvedValue(null);
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
        // Task 30 รอบ 3 M5 — ไม่รับสาย ไม่ใช่ข้อความแจ้งล็อก ⇒ ยังถูกระงับช่วงผ่อนผันหลังผูก LINE ได้
        { legacyGraceExempt: false },
      );
    });

    it.each(['DEVICE_LOCKED', 'DEVICE_UNLOCKED'] as const)(
      'Task 30 รอบ 3 M5 — %s (แจ้งเหตุล็อก/ปลดล็อกเครื่อง) ไม่ถูกระงับช่วงผ่อนผันหลังผูก LINE',
      async (eventKey) => {
        mockPrisma.dunningRule.findFirst.mockResolvedValueOnce({
          ...eventRule,
          eventTrigger: eventKey,
        });

        await service.executeEventTrigger(eventKey, 'c-1', null, null);

        expect(mockNotificationsService.send.mock.calls[0][1]).toEqual({ legacyGraceExempt: true });
      },
    );

    describe('Task 30 รอบ 6 m7 — ทางโทรส่ง paymentId = null ⇒ เติมงวด/ยอดจากงวดค้างที่เก่าที่สุด', () => {
      const ruleWithPaymentVars = {
        ...eventRule,
        messageTemplate:
          'เรียน {{customerName}} กรุณาติดต่อกลับเพื่อชำระงวดที่ {{installmentNo}} ยอด {{amount}} ฿',
      };

      it('ไม่มี paymentId → ใช้งวดค้างที่ครบกำหนดแล้วงวดแรก (นิยามเดียวกับแจ้งสถานะ/ขั้นทวง) — ข้อความไม่มีช่องว่าง', async () => {
        mockPrisma.dunningRule.findFirst.mockResolvedValueOnce(ruleWithPaymentVars);
        mockPrisma.payment.findFirst.mockResolvedValueOnce({
          id: 'pay-3',
          installmentNo: 3,
          amountDue: { toNumber: () => 1515.83 },
          dueDate: new Date('2026-10-01T17:00:00Z'),
        });

        await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

        const { where, orderBy } = mockPrisma.payment.findFirst.mock.calls[0][0];
        expect(where).toMatchObject({
          contractId: 'c-1',
          deletedAt: null,
          status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          dueDate: { lt: expect.any(Date) },
        });
        expect(orderBy).toEqual({ installmentNo: 'asc' });
        const message = mockNotificationsService.send.mock.calls[0][0].message;
        expect(message).toContain('งวดที่ 3');
        expect(message).toContain('1,515.83');
        expect(message).not.toMatch(/งวดที่\s+ยอด|ยอด\s+฿/);
      });

      it('ไม่มี paymentId และไม่มีงวดค้าง + ข้อความต้องใช้งวด/ยอด → ไม่ส่ง (SKIPPED) ไม่ส่งข้อความที่มีช่องว่าง', async () => {
        mockPrisma.dunningRule.findFirst.mockResolvedValueOnce(ruleWithPaymentVars);

        await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

        expect(mockNotificationsService.send).not.toHaveBeenCalled();
        expect(mockPrisma.dunningAction.create.mock.calls[0][0].data).toMatchObject({
          status: 'SKIPPED',
          result: 'NO_DUE_INSTALLMENT',
        });
      });

      it('ไม่มีงวดค้าง แต่ข้อความไม่ใช้งวด/ยอด (เช่น ปลดล็อก) → ส่งตามเดิม', async () => {
        await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

        expect(mockNotificationsService.send).toHaveBeenCalledTimes(1);
      });
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
        customer: { ...sampleContract.customer, lineIdFinance: null, lineLinks: [] },
      });

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, null);

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED' }),
        }),
      );
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
    });

    it('Task 22 I-1 (ง): คอลัมน์ lineIdFinance ค้างแต่ไม่มีแถว OTP → SKIPPED ไม่ส่งไปค่านั้น', async () => {
      mockPrisma.contract.findUnique.mockResolvedValueOnce({
        ...sampleContract,
        customer: { ...sampleContract.customer, lineIdFinance: 'U-stale', lineLinks: [] },
      });

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, null);

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED' }),
        }),
      );
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
    });

    it('ลูกค้าไม่มีเบอร์ (phone null) — กฎ SMS ข้าม (SKIPPED) ไม่ส่ง', async () => {
      mockPrisma.dunningRule.findFirst.mockResolvedValueOnce({ ...eventRule, channel: 'SMS' });
      mockPrisma.contract.findUnique.mockResolvedValueOnce({
        ...sampleContract,
        customer: { ...sampleContract.customer, phone: null },
      });

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, null);

      expect(mockPrisma.dunningAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED' }),
        }),
      );
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
    });

    it('ลูกค้าไม่มีเบอร์ (phone null) — กฎ LINE ยังส่ง แต่ fallbackPhone = undefined', async () => {
      mockPrisma.contract.findUnique.mockResolvedValueOnce({
        ...sampleContract,
        customer: { ...sampleContract.customer, phone: null },
      });

      await service.executeEventTrigger('CALL_NO_ANSWER', 'c-1', null, 'cl-1');

      expect(mockNotificationsService.send).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.send.mock.calls[0][0]).toHaveProperty(
        'fallbackPhone',
        undefined,
      );
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
