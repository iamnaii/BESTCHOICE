import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { ComplianceService } from './compliance.service';
import { NotificationTemplateService } from './notification-template.service';

describe('NotificationsService — channel routing', () => {
  let service: NotificationsService;
  let integrationConfig: { getValue: jest.Mock };

  beforeEach(async () => {
    integrationConfig = { getValue: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: { notificationLog: { create: jest.fn() } } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: ComplianceService, useValue: { canSend: jest.fn().mockResolvedValue({ allowed: true }) } },
        { provide: NotificationTemplateService, useValue: { findByEventType: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('getLineToken("line-shop") reads line-shop channelToken', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('shop-token-xxx');
    const token = await (service as any).getLineToken('line-shop');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'channelToken');
    expect(token).toBe('shop-token-xxx');
  });

  it('getLineToken("line-finance") reads line-finance channelToken', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('finance-token-yyy');
    const token = await (service as any).getLineToken('line-finance');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
    expect(token).toBe('finance-token-yyy');
  });

  it('getLineToken("line-staff") reads line-staff channelToken', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('staff-token-zzz');
    const token = await (service as any).getLineToken('line-staff');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-staff', 'channelToken');
    expect(token).toBe('staff-token-zzz');
  });
});
