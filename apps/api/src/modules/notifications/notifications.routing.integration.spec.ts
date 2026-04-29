import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('NotificationsService — integration: per-channel routing', () => {
  let service: NotificationsService;
  let prisma: any;
  let integrationConfig: { getValue: jest.Mock };
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    prisma = { notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) } };
    integrationConfig = { getValue: jest.fn() };
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }) as any);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('LINE send with channelKey=line-finance uses finance token', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('finance-token-yyy');

    await service.send({
      channelKey: 'line-finance',
      channel: 'LINE',
      recipient: 'Uxxx',
      message: 'test finance',
    });

    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.line.me/v2/bot/message/push'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer finance-token-yyy' }),
      }),
    );
  });

  it('LINE send with channelKey=line-staff uses staff token', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('staff-token-zzz');

    await service.send({
      channelKey: 'line-staff',
      channel: 'LINE',
      recipient: 'Uxxx',
      message: 'staff alert',
    });

    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-staff', 'channelToken');
  });

  it('LINE send with channelKey=line-shop uses shop token', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('shop-token-aaa');

    await service.send({
      channelKey: 'line-shop',
      channel: 'LINE',
      recipient: 'Uxxx',
      message: 'shop promo',
    });

    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'channelToken');
  });

  it('LINE send without channelKey throws BadRequestException (Phase 7 hardening)', async () => {
    await expect(
      service.send({
        channel: 'LINE',
        recipient: 'Uxxx',
        message: 'no channelKey',
      }),
    ).rejects.toThrow(/channelKey จำเป็นสำหรับ LINE/);
  });
});
