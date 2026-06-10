import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { ComplianceService } from './compliance.service';
import { NotificationTemplateService } from './notification-template.service';

/**
 * Characterization tests for the two customer-facing dunning cron methods
 * `sendPaymentReminders` (upcoming) and `sendOverdueNotices` (past-due).
 *
 * These had ZERO coverage. They share an identical per-payment guard pair —
 * the "already notified today" dedup check and the PDPA-consent gate (skip +
 * IN_APP SKIPPED log) — extracted into shared helpers in this PR (Wave-4
 * dedup). These tests lock that guard behavior + the happy LINE path so the
 * extraction is verifiably behaviour-preserving.
 */
describe('NotificationsService — reminder / overdue dunning', () => {
  let service: NotificationsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const customer = (over: Record<string, unknown> = {}) => ({
    id: 'cust-1',
    name: 'สมชาย',
    phone: '0812345678',
    lineIdFinance: null,
    ...over,
  });

  const payment = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    installmentNo: 2,
    amountDue: 1500,
    amountPaid: 0,
    lateFee: 0,
    dueDate: new Date(),
    contract: { contractNumber: 'CT-001', customer: customer(), _count: { payments: 6 } },
    ...over,
  });

  const withLine = () =>
    payment({
      contract: {
        contractNumber: 'CT-001',
        customer: customer({ lineIdFinance: 'U-line' }),
        _count: { payments: 6 },
      },
    });

  beforeEach(async () => {
    prisma = {
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      notificationLog: {
        findFirst: jest.fn().mockResolvedValue(null), // not a duplicate
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      pDPAConsent: { findFirst: jest.fn().mockResolvedValue({ id: 'consent-1' }) }, // granted
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: FlexTemplatesService,
          useValue: {
            paymentReminder: jest.fn().mockReturnValue({}),
            overdueNotice: jest.fn().mockReturnValue({}),
          },
        },
        { provide: QuickReplyService, useValue: { afterPayment: jest.fn().mockReturnValue([]) } },
        {
          provide: IntegrationConfigService,
          useValue: { getValue: jest.fn().mockResolvedValue('') },
        },
        {
          provide: ComplianceService,
          useValue: { canSend: jest.fn().mockResolvedValue({ allowed: true }) },
        },
        { provide: NotificationTemplateService, useValue: { findByEventType: jest.fn() } },
      ],
    }).compile();

    service = mod.get(NotificationsService);
    // Stub actual delivery so tests assert branch decisions, not real I/O.
    // After the Transport/Dispatch decompose these live on the sub-services the
    // reminder cron delegates to: sendLineFlexMessage → transport, send +
    // sendFromTemplate → dispatch. Retarget the spies (assertions unchanged).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service.transport as any, 'sendLineFlexMessage').mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service.dispatch as any, 'send').mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service.dispatch as any, 'sendFromTemplate').mockResolvedValue(undefined);
  });

  const spyOf = (name: string) =>
    (name === 'sendLineFlexMessage'
      ? (service.transport as any)[name]
      : (service.dispatch as any)[name]) as jest.Mock;

  describe('sendPaymentReminders', () => {
    const SUBJECT = 'แจ้งเตือนค่างวด';

    it('logs an IN_APP SKIPPED row and sends nothing when the customer has no PDPA consent', async () => {
      prisma.payment.findMany.mockResolvedValue([payment()]);
      prisma.pDPAConsent.findFirst.mockResolvedValue(null);

      const result = await service.sendPaymentReminders();

      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: 'IN_APP',
            status: 'SKIPPED',
            subject: SUBJECT,
            relatedId: 'pay-1',
          }),
        }),
      );
      expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
      expect(spyOf('send')).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });

    it('skips a payment already reminded today (dedup) without checking consent or sending', async () => {
      prisma.payment.findMany.mockResolvedValue([payment()]);
      prisma.notificationLog.findFirst.mockResolvedValue({ id: 'prev-log' });

      const result = await service.sendPaymentReminders();

      expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
      expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });

    it('sends a LINE flex reminder and logs SENT when the customer has lineIdFinance + consent', async () => {
      prisma.payment.findMany.mockResolvedValue([withLine()]);

      const result = await service.sendPaymentReminders();

      expect(spyOf('sendLineFlexMessage')).toHaveBeenCalledWith(
        'U-line',
        expect.anything(),
        'line-finance',
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: 'LINE', status: 'SENT', subject: SUBJECT }),
        }),
      );
      expect(result.sent).toBe(1);
    });

    it('dedup query filters by relatedId + subject', async () => {
      prisma.payment.findMany.mockResolvedValue([payment()]);
      await service.sendPaymentReminders();
      expect(prisma.notificationLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ relatedId: 'pay-1', subject: SUBJECT }),
        }),
      );
    });
  });

  describe('sendOverdueNotices', () => {
    const SUBJECT = 'แจ้งค้างชำระ';

    it('logs an IN_APP SKIPPED row and sends nothing when the customer has no PDPA consent', async () => {
      prisma.payment.findMany.mockResolvedValue([payment()]);
      prisma.pDPAConsent.findFirst.mockResolvedValue(null);

      const result = await service.sendOverdueNotices();

      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: 'IN_APP',
            status: 'SKIPPED',
            subject: SUBJECT,
            relatedId: 'pay-1',
          }),
        }),
      );
      expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });

    it('skips a payment already noticed today (dedup) without checking consent or sending', async () => {
      prisma.payment.findMany.mockResolvedValue([payment()]);
      prisma.notificationLog.findFirst.mockResolvedValue({ id: 'prev-log' });

      const result = await service.sendOverdueNotices();

      expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
      expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });

    it('sends a LINE flex overdue notice and logs SENT when the customer has lineIdFinance + consent', async () => {
      prisma.payment.findMany.mockResolvedValue([withLine()]);

      const result = await service.sendOverdueNotices();

      expect(spyOf('sendLineFlexMessage')).toHaveBeenCalledWith(
        'U-line',
        expect.anything(),
        'line-finance',
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: 'LINE', status: 'SENT', subject: SUBJECT }),
        }),
      );
      expect(result.sent).toBe(1);
    });
  });
});
