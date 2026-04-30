import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { NotificationCategory } from './notification-category.enum';
import { NotificationTemplateService } from './notification-template.service';

describe('NotificationsService — compliance integration', () => {
  let service: NotificationsService;
  let prisma: any;
  let pdpa: { hasActiveConsent: jest.Mock };
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    prisma = {
      notificationLog: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'log1', ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    pdpa = { hasActiveConsent: jest.fn().mockResolvedValue(true) };
    const integrationConfig = { getValue: jest.fn().mockResolvedValue('token') };
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }) as any);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        ComplianceService,
        HolidayService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: PDPAService, useValue: pdpa },
        { provide: NotificationTemplateService, useValue: { findByEventType: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('DUNNING outside hours → status=DELAYED (queued, not failed)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T16:00:00Z')); // 23:00 ICT
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: '[BESTCHOICE FINANCE] dunning',
      customerId: 'c1',
      relatedId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.status).toBe('DELAYED');
    expect(result.blockReason).toBe('OUTSIDE_HOURS');
    const createCall = prisma.notificationLog.create.mock.calls[0][0];
    expect(createCall.data.status).toBe('DELAYED');
    expect(createCall.data.blockReason).toBe('OUTSIDE_HOURS');
    expect(createCall.data.nextRetryAt).toBeInstanceOf(Date);
  });

  it('DUNNING with no PDPA consent → status=BLOCKED', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z')); // 14:00 ICT
    pdpa.hasActiveConsent.mockResolvedValueOnce(false);
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: '[BESTCHOICE FINANCE] dunning',
      customerId: 'c1',
      relatedId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toBe('NO_CONSENT');
  });

  it('TRANSACTIONAL bypasses compliance (sends even at 03:00 ICT)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z')); // 03:00 ICT next day
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: 'Receipt',
      customerId: 'c1',
      category: NotificationCategory.TRANSACTIONAL,
    });
    expect(result.status).toBe('SENT');
    // No blockReason on success path
    const createCall = prisma.notificationLog.create.mock.calls[0][0];
    expect(createCall.data.blockReason).toBeNull();
  });

  it('STAFF bypasses time window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z')); // 03:00 ICT
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-staff',
      recipient: 'Ustaff',
      message: 'manager alert',
      category: NotificationCategory.STAFF,
    });
    expect(result.status).toBe('SENT');
  });

  it('frequency cap blocks 2nd DUNNING same day same contract', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
    prisma.notificationLog.count.mockResolvedValueOnce(1); // already sent today
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: '[BESTCHOICE FINANCE] reminder',
      customerId: 'c1',
      relatedId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toBe('FREQUENCY_CAP');
  });
});
