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

  // Task 22 I-1 (ง) — ปลายทาง LINE = แถว OTP (lineLinks) ไม่ใช่คอลัมน์ lineIdFinance
  const customer = (over: Record<string, unknown> = {}) => ({
    id: 'cust-1',
    name: 'สมชาย',
    phone: '0812345678',
    lineIdFinance: null,
    lineLinks: over.lineIdFinance ? [{ lineUserId: over.lineIdFinance as string }] : [],
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

  /** คอลัมน์มีค่า (พนักงานพิมพ์/ค้าง) แต่ไม่มีแถว OTP */
  const withStaleColumn = () =>
    payment({
      contract: {
        contractNumber: 'CT-001',
        customer: customer({ lineIdFinance: 'U-stale', lineLinks: [] }),
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
      // Task 30 ข้อ 1 — บอทการเงิน (A8) ยังไม่ได้ส่งงวดนี้วันนี้
      chatAutoTrigger: { findFirst: jest.fn().mockResolvedValue(null) },
      // Task 30 ข้อ 2 — ไม่มีสัญญาในช่วงผ่อนผันหลังผูก LINE
      contract: { findMany: jest.fn().mockResolvedValue([]) },
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
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private collaborator (pre-existing)
        (service.transport as any)[name]
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private collaborator (pre-existing)
        (service.dispatch as any)[name]) as jest.Mock;

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

    it('Task 22 I-1 (ง): คอลัมน์ lineIdFinance ค้างแต่ไม่มีแถว OTP → ไม่ส่ง LINE ไปค่านั้น', async () => {
      prisma.payment.findMany.mockResolvedValue([withStaleColumn()]);

      await service.sendPaymentReminders();

      expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
      for (const [arg] of prisma.notificationLog.create.mock.calls) {
        expect(arg.data.recipient).not.toBe('U-stale');
      }
    });

    it('dedup query filters by relatedId + (subject OR REMINDER category) — counts fallback paths too', async () => {
      prisma.payment.findMany.mockResolvedValue([payment()]);
      await service.sendPaymentReminders();
      const where = prisma.notificationLog.findFirst.mock.calls[0][0].where;
      expect(where.relatedId).toBe('pay-1');
      // Task 30 ข้อ 1 — ทางสำรอง template/ข้อความ/SMS ลงหัวข้อของ template หรือว่าง แต่หมวด REMINDER เสมอ
      expect(where.AND[0]).toEqual({ OR: [{ subject: SUBJECT }, { category: 'REMINDER' }] });
      // ส่งแล้ววันนี้ หรือ A1 ยังถือการส่งอยู่ (คิวส่งซ้ำ / รอเวลาทำการ)
      expect(where.AND[1].OR).toEqual([
        { status: 'SENT', sentAt: { gte: expect.any(Date) } },
        { status: { in: ['RETRY_PENDING', 'DELAYED'] }, createdAt: { gte: expect.any(Date) } },
      ]);
    });

    describe('Task 30 ข้อ 1 — งวดละหนึ่งข้อความต่อวัน (A1 08:00 กับบอท A8 09:00)', () => {
      it('ข้ามงวดที่บอทการเงินส่งเตือนไปแล้ววันนี้ — ไม่ส่ง LINE ไม่ส่ง SMS ไม่แตะ consent', async () => {
        prisma.payment.findMany.mockResolvedValue([withLine(), payment({ id: 'pay-2' })]);
        prisma.chatAutoTrigger.findFirst.mockResolvedValue({ id: 'trig-1' });

        const result = await service.sendPaymentReminders();

        expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
        expect(spyOf('send')).not.toHaveBeenCalled();
        expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
        expect(prisma.notificationLog.create).not.toHaveBeenCalled();
        expect(result.sent).toBe(0);
        expect(result.dedupedByBot).toBe(2);
      });

      it('ค้นแถวบอทของงวดนี้ทุกชนิดเตือน (T-5/T-3/T-1/T0) เฉพาะที่ส่ง/กำลังส่ง ตั้งแต่เที่ยงคืนไทยวันนี้', async () => {
        prisma.payment.findMany.mockResolvedValue([withLine()]);

        await service.sendPaymentReminders();

        const where = prisma.chatAutoTrigger.findFirst.mock.calls[0][0].where;
        expect(where.customerId).toBe('cust-1');
        expect(where.referenceKey.in).toEqual([
          'REMINDER_T_MINUS_5:pay-1',
          'REMINDER_T_MINUS_3:pay-1',
          'REMINDER_T_MINUS_1:pay-1',
          'REMINDER_T_DAY:pay-1',
        ]);
        expect(where.status).toEqual({ in: ['SENT', 'PENDING'] });
        // เที่ยงคืนไทย = 17:00 UTC ของวันก่อน (ไม่ขึ้นกับ TZ เครื่อง)
        const dayStart: Date = where.createdAt.gte;
        expect(dayStart.getUTCHours()).toBe(17);
        expect(Date.now() - dayStart.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
        expect(spyOf('sendLineFlexMessage')).toHaveBeenCalledTimes(1);
      });
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

    describe('Task 30 รอบ 2 ข้อ 3 — ทวง T+1/T+3 งวดละหนึ่งข้อความต่อวัน (A2 ตัวหลัก · บอทตัวสำรอง)', () => {
      it('ข้ามงวดที่บอทการเงินส่งทวง T+1/T+3 ไปแล้ววันนี้ — ไม่ส่ง LINE/SMS ไม่แตะ consent', async () => {
        prisma.payment.findMany.mockResolvedValue([withLine()]);
        prisma.chatAutoTrigger.findFirst.mockResolvedValue({ id: 'trig-esc' });

        const result = await service.sendOverdueNotices();

        expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
        expect(spyOf('send')).not.toHaveBeenCalled();
        expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
        expect(result.sent).toBe(0);
        expect(result.dedupedByBot).toBe(1);
        const where = prisma.chatAutoTrigger.findFirst.mock.calls[0][0].where;
        expect(where.referenceKey.in).toEqual([
          'ESCALATION_T_PLUS_1:pay-1',
          'ESCALATION_T_PLUS_3:pay-1',
        ]);
        expect(where.status).toEqual({ in: ['SENT', 'PENDING'] });
      });

      it('กันซ้ำของ A2 เองนับทุกทาง (หัวข้อ Flex หรือหมวด DUNNING ของงวด) + แถวที่ยังรอคิวส่งซ้ำ', async () => {
        prisma.payment.findMany.mockResolvedValue([withLine()]);

        await service.sendOverdueNotices();

        const where = prisma.notificationLog.findFirst.mock.calls[0][0].where;
        expect(where.relatedId).toBe('pay-1');
        expect(where.AND[0]).toEqual({ OR: [{ subject: SUBJECT }, { category: 'DUNNING' }] });
        expect(where.AND[1].OR[1]).toEqual({
          status: { in: ['RETRY_PENDING', 'DELAYED'] },
          createdAt: { gte: expect.any(Date) },
        });
      });
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

    it('Task 22 I-1 (ง): คอลัมน์ lineIdFinance ค้างแต่ไม่มีแถว OTP → ไม่ส่ง LINE ไปค่านั้น', async () => {
      prisma.payment.findMany.mockResolvedValue([withStaleColumn()]);

      await service.sendOverdueNotices();

      expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
      for (const [arg] of prisma.notificationLog.create.mock.calls) {
        expect(arg.data.recipient).not.toBe('U-stale');
      }
    });

    describe('Task 30 ข้อ 2 — ผ่อนผัน 7 วันหลังผูก LINE (สัญญานำเข้า)', () => {
      const lineOverdue = (contractId: string) => ({ ...withLine(), contractId });

      it('สัญญาในช่วงผ่อนผัน → ไม่ส่ง LINE ไม่ส่ง SMS ไม่แตะ consent · แถว BLOCKED LEGACY_LINK_GRACE', async () => {
        prisma.payment.findMany.mockResolvedValue([lineOverdue('k-legacy')]);
        prisma.contract.findMany.mockResolvedValue([{ id: 'k-legacy' }]);

        const result = await service.sendOverdueNotices();

        expect(spyOf('sendLineFlexMessage')).not.toHaveBeenCalled();
        expect(spyOf('sendFromTemplate')).not.toHaveBeenCalled();
        expect(spyOf('send')).not.toHaveBeenCalled();
        expect(prisma.pDPAConsent.findFirst).not.toHaveBeenCalled();
        expect(prisma.notificationLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              channel: 'LINE',
              recipient: 'U-line',
              status: 'BLOCKED',
              blockReason: 'LEGACY_LINK_GRACE',
              category: 'DUNNING',
              subject: SUBJECT,
              relatedId: 'pay-1',
              customerId: 'cust-1',
            }),
          }),
        );
        expect(result.sent).toBe(0);
        // query เดียวต่อรอบ ด้วย id สัญญาของงวดที่จะแจ้ง
        expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.contract.findMany.mock.calls[0][0].where.id).toEqual({ in: ['k-legacy'] });
      });

      it('สัญญานอกช่วง (ไม่นำเข้า / ผูกเกิน 7 วัน) → แจ้งค้างชำระตามเดิม', async () => {
        prisma.payment.findMany.mockResolvedValue([lineOverdue('k-native')]);

        const result = await service.sendOverdueNotices();

        expect(spyOf('sendLineFlexMessage')).toHaveBeenCalledWith(
          'U-line',
          expect.anything(),
          'line-finance',
        );
        expect(result.sent).toBe(1);
      });

      it('เตือนค่างวดไม่ถามช่วงผ่อนผัน (ยังส่งระหว่างผ่อนผัน)', async () => {
        prisma.payment.findMany.mockResolvedValue([lineOverdue('k-legacy')]);
        prisma.contract.findMany.mockResolvedValue([{ id: 'k-legacy' }]);

        const result = await service.sendPaymentReminders();

        expect(prisma.contract.findMany).not.toHaveBeenCalled();
        expect(spyOf('sendLineFlexMessage')).toHaveBeenCalledTimes(1);
        expect(result.sent).toBe(1);
      });
    });
  });
});
