import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { ComplianceService } from './compliance.service';
import { NotificationTemplateService } from './notification-template.service';

/**
 * D1.3.1.4 — IN_APP notifications master kill switch tests.
 *
 * When SystemConfig `in_app_notifications_enabled` is `'false'`, IN_APP
 * sends must:
 *   1. NOT throw (cron jobs + transactional flows blindly await — throwing
 *      would cascade-fail unrelated user flows).
 *   2. NOT write a notification_logs row (silent skip).
 *   3. Return `{ id: '', status: 'SKIPPED', blockReason: 'IN_APP_DISABLED' }`
 *      so callers that check status can react.
 *   4. Still allow LINE / SMS to flow normally.
 */
describe('NotificationsService — D1.3.1.4 IN_APP toggle', () => {
  let service: NotificationsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      notificationLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-x' }),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
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
    service = moduleRef.get(NotificationsService);
  });

  it('IN_APP default-ON when key missing — DB write happens', async () => {
    // No SystemConfig row → readBoolFlag returns `true` → send proceeds
    const result = await service.send({
      channel: 'IN_APP',
      recipient: 'user@example.com',
      subject: 'Hello',
      message: 'World',
    });
    expect(result.status).toBe('SENT');
    expect(prisma.notificationLog.create).toHaveBeenCalled();
  });

  it('IN_APP silently no-ops (no throw, no DB write) when flag = false', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'in_app_notifications_enabled') {
          return Promise.resolve({ value: 'false' });
        }
        return Promise.resolve(null);
      },
    );

    const result = await service.send({
      channel: 'IN_APP',
      recipient: 'user@example.com',
      subject: 'Hello',
      message: 'World',
    });

    expect(result).toEqual({
      id: '',
      status: 'SKIPPED',
      blockReason: 'IN_APP_DISABLED',
    });
    // Critical: no notification_logs row created — silent skip
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('flag = false does NOT affect LINE/SMS channels (cron safety)', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'in_app_notifications_enabled') {
          return Promise.resolve({ value: 'false' });
        }
        return Promise.resolve(null);
      },
    );

    // LINE without channelKey — should still throw the existing validation
    // (proves the IN_APP gate didn't accidentally early-return for LINE)
    await expect(
      service.send({
        channel: 'LINE',
        recipient: 'U123',
        subject: 's',
        message: 'm',
      }),
    ).rejects.toThrow(/channelKey จำเป็นสำหรับ LINE/);
  });
});
