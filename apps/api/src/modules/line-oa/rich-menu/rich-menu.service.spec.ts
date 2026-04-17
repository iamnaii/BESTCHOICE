import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RichMenuService } from './rich-menu.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

describe('RichMenuService', () => {
  let service: RichMenuService;
  let integrationConfig: { getValue: jest.Mock };

  beforeEach(async () => {
    integrationConfig = { getValue: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RichMenuService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PrismaService, useValue: { systemConfig: { findFirst: jest.fn(), upsert: jest.fn() } } },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();

    service = module.get<RichMenuService>(RichMenuService);
  });

  describe('getChannelToken', () => {
    it('returns SHOP token when channel=shop', async () => {
      integrationConfig.getValue.mockImplementation((key, field) =>
        Promise.resolve(key === 'line-shop' && field === 'channelToken' ? 'shop-token-123' : null),
      );

      const token = await (service as any).getChannelToken('shop');

      expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'channelToken');
      expect(token).toBe('shop-token-123');
    });

    it('returns FINANCE token when channel=finance', async () => {
      integrationConfig.getValue.mockImplementation((key, field) =>
        Promise.resolve(key === 'line-finance' && field === 'channelToken' ? 'finance-token-456' : null),
      );

      const token = await (service as any).getChannelToken('finance');

      expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
      expect(token).toBe('finance-token-456');
    });

    it('throws BadRequestException when token not configured', async () => {
      integrationConfig.getValue.mockResolvedValue(null);

      await expect((service as any).getChannelToken('finance')).rejects.toThrow(BadRequestException);
    });
  });
});
