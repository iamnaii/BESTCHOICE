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

  describe('setRichMenuAlias', () => {
    it('writes SystemConfig with correct key for shop/default', async () => {
      const prismaUpsert = jest.fn().mockResolvedValue({});
      (service as any).prisma = {
        systemConfig: { upsert: prismaUpsert, findFirst: jest.fn() },
      };
      // Mock setDefaultRichMenu (variant=default triggers LINE API)
      const setDefaultSpy = jest.spyOn(service, 'setDefaultRichMenu').mockResolvedValue(undefined);

      await service.setRichMenuAlias('shop', 'default', 'rm-123');

      expect(prismaUpsert).toHaveBeenCalledWith({
        where: { key: 'line.richMenu.shopDefault' },
        create: { key: 'line.richMenu.shopDefault', value: 'rm-123' },
        update: { value: 'rm-123', deletedAt: null },
      });
      expect(setDefaultSpy).toHaveBeenCalledWith('rm-123', 'shop');
    });

    it('writes SystemConfig for finance/verified without calling setDefaultRichMenu', async () => {
      const prismaUpsert = jest.fn().mockResolvedValue({});
      (service as any).prisma = {
        systemConfig: { upsert: prismaUpsert, findFirst: jest.fn() },
      };
      const setDefaultSpy = jest.spyOn(service, 'setDefaultRichMenu').mockResolvedValue(undefined);

      await service.setRichMenuAlias('finance', 'verified', 'rm-456');

      expect(prismaUpsert).toHaveBeenCalledWith({
        where: { key: 'line.richMenu.financeVerified' },
        create: { key: 'line.richMenu.financeVerified', value: 'rm-456' },
        update: { value: 'rm-456', deletedAt: null },
      });
      expect(setDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('getRichMenuAliases', () => {
    it('returns all 4 alias values with null for missing keys', async () => {
      const prismaFindFirst = jest.fn().mockImplementation(({ where }) => {
        if (where.key === 'line.richMenu.shopDefault') {
          return Promise.resolve({ value: 'rm-shop-default' });
        }
        if (where.key === 'line.richMenu.financeVerified') {
          return Promise.resolve({ value: 'rm-finance-verified' });
        }
        return Promise.resolve(null);
      });
      (service as any).prisma = {
        systemConfig: { findFirst: prismaFindFirst, upsert: jest.fn() },
      };

      const aliases = await service.getRichMenuAliases();

      expect(aliases).toEqual({
        shopDefault: 'rm-shop-default',
        shopVerified: null,
        financeDefault: null,
        financeVerified: 'rm-finance-verified',
      });
    });
  });

  describe('switchRichMenu', () => {
    it.each([
      ['shop', true, 'line.richMenu.shopVerified'],
      ['shop', false, 'line.richMenu.shopDefault'],
      ['finance', true, 'line.richMenu.financeVerified'],
      ['finance', false, 'line.richMenu.financeDefault'],
    ] as const)(
      'composes SystemConfig key for channel=%s verified=%s -> %s',
      async (channel, isVerified, expectedKey) => {
        const getConfigSpy = jest
          .spyOn(service, 'getRichMenuIdFromConfig')
          .mockResolvedValue(null);

        await service.switchRichMenu('U123', isVerified, channel);

        expect(getConfigSpy).toHaveBeenCalledWith(expectedKey);
      },
    );

    it('uses channel-specific token when linking Rich Menu', async () => {
      jest.spyOn(service, 'getRichMenuIdFromConfig').mockResolvedValue('rm-finance-99');
      integrationConfig.getValue.mockImplementation((key) =>
        Promise.resolve(key === 'line-finance' ? 'finance-token' : null),
      );
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const originalFetch = global.fetch;
      global.fetch = fetchMock as any;

      try {
        await service.switchRichMenu('U123', true, 'finance');

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/user/U123/richmenu/rm-finance-99'),
          expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer finance-token' }),
          }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('skips LINE API call when config key has no value', async () => {
      jest.spyOn(service, 'getRichMenuIdFromConfig').mockResolvedValue(null);
      const fetchMock = jest.fn();
      const originalFetch = global.fetch;
      global.fetch = fetchMock as any;

      try {
        await service.switchRichMenu('U123', false, 'shop');
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('listRichMenus', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('uses FINANCE token when channel=finance', async () => {
      integrationConfig.getValue.mockImplementation((key) =>
        Promise.resolve(key === 'line-finance' ? 'finance-token' : null),
      );
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ richmenus: [] }),
      });
      global.fetch = fetchMock as any;

      await service.listRichMenus('finance');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/richmenu/list'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer finance-token' }),
        }),
      );
    });

    it('defaults to SHOP token when channel omitted', async () => {
      integrationConfig.getValue.mockImplementation((key) =>
        Promise.resolve(key === 'line-shop' ? 'shop-token' : null),
      );
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ richmenus: [] }),
      });
      global.fetch = fetchMock as any;

      await service.listRichMenus();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer shop-token' }),
        }),
      );
    });
  });
});
