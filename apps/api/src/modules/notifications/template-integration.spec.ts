import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationTemplateService } from './notification-template.service';
import { ComplianceService } from './compliance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('NotificationsService — sendFromTemplate integration', () => {
  let service: NotificationsService;
  let prisma: any;
  let templateService: { findByEventType: jest.Mock };
  let integrationConfig: { getValue: jest.Mock };
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    prisma = {
      notificationLog: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'log1', ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    templateService = { findByEventType: jest.fn() };
    integrationConfig = { getValue: jest.fn().mockResolvedValue('token') };
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }) as any);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        {
          provide: ComplianceService,
          useValue: {
            canSend: jest.fn().mockResolvedValue({ allowed: true }),
            ensureIdentificationPrefix: jest.fn((msg: string) => msg),
            scanForbiddenContent: jest.fn(),
            validateContent: jest.fn().mockReturnValue({ ok: true }),
          },
        },
        { provide: NotificationTemplateService, useValue: templateService },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('renders template + sends with template category and channelKey', async () => {
    templateService.findByEventType.mockResolvedValueOnce({
      eventType: 'dunning.reminder',
      name: 'Reminder',
      category: 'DUNNING',
      channel: 'LINE',
      channelKey: 'line-finance',
      format: 'text',
      subject: null,
      messageTemplate: '[BESTCHOICE FINANCE] hi ${name}, owe ${amount}',
      flexTemplate: null,
      isActive: true,
      sampleData: null,
    });

    const result = await service.sendFromTemplate(
      'dunning.reminder',
      { name: 'John', amount: '1500' },
      'Uxxx',
      { customerId: 'c1', relatedId: 'k1' },
    );

    expect(result.status).toBe('SENT');
    const createCall = prisma.notificationLog.create.mock.calls[0][0];
    expect(createCall.data.message).toBe('[BESTCHOICE FINANCE] hi John, owe 1500');
    expect(createCall.data.category).toBe('DUNNING');
    expect(createCall.data.channelKey).toBe('line-finance');
  });

  it('throws InternalServerErrorException when template missing', async () => {
    templateService.findByEventType.mockResolvedValueOnce(null);
    await expect(
      service.sendFromTemplate('nonexistent.template', {}, 'Uxxx', {}),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('returns BLOCKED when template inactive', async () => {
    templateService.findByEventType.mockResolvedValueOnce({
      eventType: 'dunning.reminder',
      name: 'Reminder',
      isActive: false,
      messageTemplate: 'hi',
      category: 'DUNNING',
      channel: 'LINE',
      channelKey: 'line-finance',
      format: 'text',
      subject: null,
      flexTemplate: null,
      sampleData: null,
    });
    const result = await service.sendFromTemplate('dunning.reminder', {}, 'Uxxx', {});
    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toBe('TEMPLATE_INACTIVE');
  });

  it('passes fallbackPhone option to underlying send', async () => {
    templateService.findByEventType.mockResolvedValueOnce({
      eventType: 'dunning.reminder',
      name: 'Reminder',
      isActive: true,
      messageTemplate: '${name}',
      category: 'DUNNING',
      channel: 'LINE',
      channelKey: 'line-finance',
      format: 'text',
      subject: null,
      flexTemplate: null,
      sampleData: null,
    });

    const sendSpy = jest.spyOn(service, 'send');

    await service.sendFromTemplate(
      'dunning.reminder',
      { name: 'John' },
      'Uxxx',
      { fallbackPhone: '0891234567', customerId: 'c1' },
    );

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackPhone: '0891234567',
        channel: 'LINE',
        channelKey: 'line-finance',
        category: 'DUNNING',
      }),
    );
  });
});
